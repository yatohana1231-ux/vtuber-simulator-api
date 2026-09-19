// -------------------------------------------------------
// API ハンドラーの共通処理（ログ出力・body のパース・入力チェックの例外化・例外の変換）
//
// absenceSimulator・dialogueGenerator・emotionUpdater・memoryRetriever の
// 4本のハンドラーが同じ形（ログ出力 → parseRequestBody → 入力チェック →
// run* → createResponse、例外は 400/500 に変換）をしているためまとめた。
// -------------------------------------------------------

import type { CharacterPackage } from "../types.js";
import { loadRequestedPackage } from "./packages.js";
import { createResponse, parseRequestBody } from "./utils.js";

export type LambdaResponse = ReturnType<typeof createResponse>;

/** 400 を返すための例外。メッセージがそのまま { "error": message } になる */
export class BadRequestError extends Error {}

/**
 * 4本のハンドラーに共通する処理。ログ出力 → parseRequestBody → handle(body) の
 * 呼び出しを行う。handle が BadRequestError を投げたら 400、それ以外の例外は
 * 今までどおり 500（errorName/errorMessage 付き）にする。
 */
export async function handleApiRequest(
  event: unknown,
  handle: (body: Record<string, unknown>) => Promise<LambdaResponse>
): Promise<LambdaResponse> {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event);
    return await handle(body);
  } catch (error) {
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

/** characterId が指定されているか確認する。無ければ BadRequestError */
export function requireCharacterId(body: Record<string, unknown>): string {
  const characterId = body.characterId as string | undefined;
  if (!characterId) {
    throw new BadRequestError("characterId is required");
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
