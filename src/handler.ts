// -------------------------------------------------------
// Lambda ハンドラー
// エントリーポイント。リクエストを受け取り processChat を呼ぶ。
// -------------------------------------------------------

import { randomUUID } from "crypto";
import { processChat } from "./application/processChat.js";
import { createResponse, normalizeProfile, parseRequestBody } from "./lib/utils.js";
import type { ChatRequest, NormalizedRequest } from "./types.js";

export const handler = async (event: unknown): Promise<unknown> => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event) as Partial<ChatRequest>;

    // message が undefined の場合は "" として扱う（プロセス1判定に使用）
    const message = body.message ?? "";
    const profile = normalizeProfile(body.characterProfile);
    const characterId = (body.characterId || "") !== "" ? body.characterId! : randomUUID();

    // lastLoginAt / now のパース
    const nowDate = body.now ? new Date(body.now) : new Date();
    const lastLoginAtDate = body.lastLoginAt
      ? new Date(body.lastLoginAt)
      : nowDate; // フォールバック：差分 0 → プロセス1-3

    if (isNaN(nowDate.getTime()) || isNaN(lastLoginAtDate.getTime())) {
      return createResponse(400, { error: "invalid lastLoginAt or now format" });
    }

    const elapsedHours =
      (nowDate.getTime() - lastLoginAtDate.getTime()) / (1000 * 60 * 60);

    const req: NormalizedRequest = {
      characterId,
      message,
      profile,
      lastLoginAt: lastLoginAtDate,
      now: nowDate,
      elapsedHours,
      actions: Array.isArray(body.actions) ? body.actions as any[] : [],
    };

    const result = await processChat(req);

    return createResponse(200, result);
  } catch (error) {
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
};
