// api-auth.js
//
// API 専用 CloudFront（フェーズ3で構築）の viewer request イベントに紐付ける
// CloudFront Function（ランタイム: cloudfront-js-2.0）。
//
// 役割:
//   - Authorization: Basic <base64(id:password)> を検証し、通らなければその場で 401 を返す。
//   - OPTIONS（CORS のプリフライト）は資格情報なしで通す。
//   - 検証を通ったリクエストは Authorization ヘッダーを削除し、照合したテスターの ID を
//     x-tester-id ヘッダー（UTF-8 の base64url、パディングなし）に入れてオリジン（API Gateway）に送る。
//   - リクエストに含まれる x-tester-id ヘッダーは、判定より前に必ず削除する
//     （クライアントが偽の値を送ってきても、照合成功時に確かめた ID の値で必ず上書きされる。
//     OPTIONS・401 応答では削除されたまま付かない）。
//
// プレースホルダー（CDK が組み込み時に文字列置換する）:
//   __ALLOWED_ORIGINS__ を、許可するオリジンの一覧を表す JSON 配列文字列
//   （例: ["https://d35a8wyhb727oo.cloudfront.net","http://localhost:5173"]）に置き換える。
//   置換後にできる `const ALLOWED_ORIGINS = [...];` が正しい JS になる。
//   このファイル単体（プレースホルダー未置換のまま）は有効な JS ではない。
//   単体テストではプレースホルダーをテスト用の配列の JSON に置換してから読み込む。
//
// KeyValueStore（1関数につき1つ、cf.kvs() で参照する）の値の形式:
//   キー: テスターの ID
//   値: "<salt>:<hash>" 形式の文字列
//     - salt: 任意の文字列（登録スクリプト側で生成する）
//     - hash: sha256(salt + ":" + password) の16進数文字列（crypto.createHash("sha256").update(...).digest("hex")）
//
// 401 応答:
//   - 本文: JSON { "error": "unauthorized" }（content-type: application/json）
//   - WWW-Authenticate は付けない（ブラウザ標準の Basic 認証ダイアログを出さないため）
//   - リクエストの origin ヘッダーが ALLOWED_ORIGINS に含まれるときだけ、
//     access-control-allow-origin（そのオリジン）と vary: origin を付ける。
//     含まれない・origin ヘッダーが無いときは CORS 関連のヘッダーを付けない。
//
// 注意: パスワード・ハッシュ・Authorization ヘッダーの値はログに出さない（console.log は使わない）。
//
// x-tester-id の base64url エンコードについて:
//   cloudfront-js-2.0 で Buffer.from(str, "base64url") が直接使えるかはフェーズ1で
//   確認できておらず（確認できたのは "base64" のみ）、不安があるため自前で変換する
//   （標準の base64 を作ってから "+" → "-"、"/" → "_" に置き換え、"=" のパディングを除く）。

import cf from "cloudfront";
import crypto from "crypto";

const ALLOWED_ORIGINS = __ALLOWED_ORIGINS__;

/**
 * "Basic <base64>" 形式のヘッダー値を { id, password } にデコードする。
 * 形式が不正、base64 のデコード結果に ":" が無い、id・password のどちらかが空の場合は null。
 */
function parseBasicAuth(headerValue) {
  if (typeof headerValue !== "string") {
    return null;
  }
  if (headerValue.slice(0, 6) !== "Basic ") {
    return null;
  }
  var encoded = headerValue.slice(6).trim();
  if (!encoded) {
    return null;
  }

  var decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (e) {
    return null;
  }

  var sepIndex = decoded.indexOf(":");
  if (sepIndex < 0) {
    return null;
  }
  var id = decoded.slice(0, sepIndex);
  var password = decoded.slice(sepIndex + 1);
  if (id.length === 0 || password.length === 0) {
    return null;
  }
  return { id: id, password: password };
}

/**
 * KeyValueStore に保存された "<salt>:<hash>" を分解する。
 * 形式が不正（文字列でない、":" が無い、salt・hash のどちらかが空）なら null。
 */
function parseStoredValue(stored) {
  if (typeof stored !== "string") {
    return null;
  }
  var sepIndex = stored.indexOf(":");
  if (sepIndex < 0) {
    return null;
  }
  var salt = stored.slice(0, sepIndex);
  var hash = stored.slice(sepIndex + 1);
  if (salt.length === 0 || hash.length === 0) {
    return null;
  }
  return { salt: salt, hash: hash };
}

/**
 * 2つの16進数文字列を全長比較する（定数時間の比較。crypto.timingSafeEqual は
 * cloudfront-js-2.0 に無いため、長さが違えば false・同じなら全文字の XOR を
 * OR で集めて 0 かどうかで判定する自前実装）。
 */
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * UTF-8 文字列を base64url（パディングなし）にエンコードする。
 * 標準の base64（Buffer.from(str, "utf8").toString("base64")、フェーズ1で使えることを
 * 確認済み）から、"+" → "-"・"/" → "_" への置き換えと "=" パディングの除去を自前で行う
 * （理由はファイル冒頭のコメント参照）。
 */
function toBase64Url(str) {
  var base64 = Buffer.from(str, "utf8").toString("base64");
  var result = "";
  for (var i = 0; i < base64.length; i++) {
    var ch = base64.charAt(i);
    if (ch === "+") {
      result += "-";
    } else if (ch === "/") {
      result += "_";
    } else if (ch === "=") {
      // パディングは付けない。
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * 401 応答を組み立てる。許可したオリジンからのリクエストのときだけ CORS ヘッダーを付ける。
 */
function unauthorizedResponse(request) {
  var headers = {
    "content-type": { value: "application/json" },
  };

  var originHeader =
    request.headers.origin && request.headers.origin.value;
  if (originHeader && ALLOWED_ORIGINS.indexOf(originHeader) !== -1) {
    headers["access-control-allow-origin"] = { value: originHeader };
    headers["vary"] = { value: "origin" };
  }

  return {
    statusCode: 401,
    statusDescription: "Unauthorized",
    headers: headers,
    body: {
      encoding: "text",
      data: JSON.stringify({ error: "unauthorized" }),
    },
  };
}

async function handler(event) {
  var request = event.request;

  // クライアントが送ってきた x-tester-id は、判定より前に必ず消す（照合成功時にだけ、
  // 確かめた ID の値で入れ直す。OPTIONS・401 応答には付かない）。
  delete request.headers["x-tester-id"];

  if (request.method === "OPTIONS") {
    return request;
  }

  var authHeaderValue =
    request.headers.authorization && request.headers.authorization.value;
  var credentials = parseBasicAuth(authHeaderValue);
  if (!credentials) {
    return unauthorizedResponse(request);
  }

  var stored;
  try {
    stored = await cf.kvs().get(credentials.id);
  } catch (e) {
    // キー未登録（未登録の ID）を含め、KVS の参照に失敗した場合はすべて 401 にする。
    return unauthorizedResponse(request);
  }

  var parsed = parseStoredValue(stored);
  if (!parsed) {
    return unauthorizedResponse(request);
  }

  var actualHash = crypto
    .createHash("sha256")
    .update(parsed.salt + ":" + credentials.password)
    .digest("hex");

  if (!timingSafeEqualHex(actualHash, parsed.hash)) {
    return unauthorizedResponse(request);
  }

  delete request.headers.authorization;
  request.headers["x-tester-id"] = { value: toBase64Url(credentials.id) };
  return request;
}
