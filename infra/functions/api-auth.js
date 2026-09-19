// api-auth.js
//
// API 専用 CloudFront（フェーズ3で構築）の viewer request イベントに紐付ける
// CloudFront Function（ランタイム: cloudfront-js-2.0）。
//
// 役割:
//   - Authorization: Basic <base64(id:password)> を検証し、通らなければその場で 401 を返す。
//   - OPTIONS（CORS のプリフライト）は資格情報なしで通す。
//   - 検証を通ったリクエストは Authorization ヘッダーを削除してからオリジン（API Gateway）に送る。
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
  return request;
}
