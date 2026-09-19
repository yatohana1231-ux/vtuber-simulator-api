// -------------------------------------------------------
// API ハンドラーの共通処理（ログ出力・body のパース・入力チェックの例外化・例外の変換）
//
// absenceSimulator・dialogueGenerator・emotionUpdater・memoryRetriever の
// 4本のハンドラーが同じ形（ログ出力 → parseRequestBody → 入力チェック →
// run* → createResponse、例外は 400/500 に変換）をしているためまとめた。
// -------------------------------------------------------

import type { CharacterPackage } from "../types.js";
import { getTesterCharacter } from "./dynamo.js";
import { loadRequestedPackage } from "./packages.js";
import { getTesterIdFromEvent } from "./testerId.js";
import { createResponse, parseRequestBody } from "./utils.js";

export type LambdaResponse = ReturnType<typeof createResponse>;

/** 400 を返すための例外。メッセージがそのまま { "error": message } になる */
export class BadRequestError extends Error {}

/** 403 を返すための例外。メッセージがそのまま { "error": message } になる */
export class ForbiddenError extends Error {}

/** ログ出力用の、イベントの要約（秘密を含まない） */
export interface EventLogSummary {
  httpMethod?: unknown;
  path?: unknown;
  requestId?: unknown;
  body?: unknown;
}

/**
 * イベントから、ログに出しても安全な項目だけを取り出す。
 *
 * API Gateway のイベントの `headers`・`multiValueHeaders`・
 * `requestContext.identity` には、CloudFront が付けた `x-api-key`（Secrets
 * Manager の API キーの値）や `Authorization`・`x-tester-id` が入るため、
 * イベント全体をログに出してはならない（CLAUDE.md「ログ等への出力が必要な
 * 場合はマスクする」）。ここでは `httpMethod`・`path`（無ければ
 * `resource`）・`requestContext.requestId`・`body` のみを残す。
 */
export function summarizeEventForLog(event: unknown): EventLogSummary {
  if (!event || typeof event !== "object") return {};
  const ev = event as Record<string, unknown>;

  const summary: EventLogSummary = {};

  if ("httpMethod" in ev) summary.httpMethod = ev.httpMethod;

  if ("path" in ev) summary.path = ev.path;
  else if ("resource" in ev) summary.path = ev.resource;

  const requestContext = ev.requestContext;
  if (requestContext && typeof requestContext === "object") {
    const requestId = (requestContext as Record<string, unknown>).requestId;
    if (requestId !== undefined) summary.requestId = requestId;
  }

  if ("body" in ev) summary.body = ev.body;

  return summary;
}

/**
 * 4本のハンドラーに共通する処理。ログ出力 → parseRequestBody → handle(body) の
 * 呼び出しを行う。handle が BadRequestError を投げたら 400、それ以外の例外は
 * 今までどおり 500（errorName/errorMessage 付き）にする。
 *
 * parseRequestBody が壊れた JSON（SyntaxError）を投げた場合は 400
 * （"invalid JSON body"）にする。パースできてもオブジェクトでない場合
 * （null・配列・数値・文字列・真偽値）も 400（"request body must be a JSON
 * object"）にする。SyntaxError 以外の例外はそのまま 500 にする（F-018）。
 *
 * 環境変数 `ENFORCE_CHARACTER_OWNERSHIP` が文字列 `"true"` のときだけ、
 * handle を呼ぶ前にキャラクターの持ち主を確かめる（それ以外の値・未設定では
 * 今までどおり確認しない。tester-character-ownership-roadmap フェーズ3c）。
 * 確認の内容は checkCharacterOwnership を参照。
 */
export async function handleApiRequest(
  event: unknown,
  handle: (body: Record<string, unknown>) => Promise<LambdaResponse>
): Promise<LambdaResponse> {
  console.log("Received event:", JSON.stringify(summarizeEventForLog(event)));

  try {
    let parsed: unknown;
    try {
      parsed = parseRequestBody(event);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BadRequestError("invalid JSON body");
      }
      throw error;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new BadRequestError("request body must be a JSON object");
    }

    const body = parsed as Record<string, unknown>;

    if (process.env.ENFORCE_CHARACTER_OWNERSHIP === "true") {
      await checkCharacterOwnership(event, body);
    }

    return await handle(body);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return createResponse(403, { error: error.message });
    }
    if (error instanceof BadRequestError) {
      return createResponse(400, { error: error.message });
    }
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
}

/**
 * キャラクターの持ち主を確かめる（`ENFORCE_CHARACTER_OWNERSHIP=true` のときだけ
 * handleApiRequest から呼ばれる。tester-character-ownership-roadmap フェーズ3c）。
 *
 * - `x-tester-id` が無い（`getTesterIdFromEvent` が null）→ ForbiddenError
 * - `body.characterId` が空でない文字列でない → 何もしない（ハンドラー側の
 *   `requireCharacterId` が 400 を返すのでここでは確認を飛ばす）
 * - `(testerId, characterId)` が登録されていない（存在しない characterId を
 *   含む）→ ForbiddenError（存在するかどうかを他人に知らせないため、
 *   x-tester-id 無しと同じ "forbidden" にする）
 * - `body.packageId` が文字列で、登録されている packageId と違う →
 *   BadRequestError（F-010 の解消）
 * - `body.packageId` が省略（undefined）→ 登録されている packageId を body に
 *   入れる（body を書き換える。null・文字列以外はここでは弾かない。
 *   requirePackage 側の検証に委ねる）
 *
 * ログにはテスター ID・characterId を出さない。
 */
async function checkCharacterOwnership(
  event: unknown,
  body: Record<string, unknown>
): Promise<void> {
  const testerId = getTesterIdFromEvent(event);
  if (testerId === null) {
    throw new ForbiddenError("forbidden");
  }

  const characterId = body.characterId;
  if (typeof characterId !== "string" || characterId === "") {
    return;
  }

  const testerCharacter = await getTesterCharacter(testerId, characterId);
  if (testerCharacter === null) {
    throw new ForbiddenError("forbidden");
  }

  const requestedPackageId = body.packageId;
  if (typeof requestedPackageId === "string") {
    if (requestedPackageId !== testerCharacter.packageId) {
      throw new BadRequestError("packageId does not match the character");
    }
  } else if (requestedPackageId === undefined) {
    body.packageId = testerCharacter.packageId;
  }
}

/**
 * characterId が空でない文字列として指定されているか確認する。
 * 未指定・文字列以外・空文字のいずれも同じメッセージの BadRequestError にする（F-018）。
 */
export function requireCharacterId(body: Record<string, unknown>): string {
  const characterId = body.characterId;
  if (typeof characterId !== "string" || characterId === "") {
    throw new BadRequestError("characterId must be a non-empty string");
  }
  return characterId;
}

/** packageId を解決する。存在しない・形式不正なら BadRequestError */
export async function requirePackage(packageId: unknown): Promise<CharacterPackage> {
  const pkg = await loadRequestedPackage(packageId);
  if (!pkg) {
    throw new BadRequestError("unknown packageId");
  }
  return pkg;
}
