// -------------------------------------------------------
// Lambda ハンドラー: POST /memory-retriever
// エントリーポイント。リクエストを受け取り runMemoryRetriever を呼ぶ。
// -------------------------------------------------------

import { runMemoryRetriever } from "../memoryRetriever/index.js";
import { createResponse, normalizeProfile, parseRequestBody } from "../lib/utils.js";
import type { Action, CharacterProfile, MemoryRetrieverRequest } from "../types.js";

export const handler = async (event: unknown): Promise<unknown> => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event);

    const characterId = body.characterId as string | undefined;
    if (!characterId) {
      return createResponse(400, { error: "characterId is required" });
    }

    const process = body.process as 1 | 2 | undefined;
    if (process !== 1 && process !== 2) {
      return createResponse(400, { error: "process must be 1 or 2" });
    }

    const characterProfile = normalizeProfile(
      body.characterProfile as Partial<CharacterProfile> | undefined
    );

    const req: MemoryRetrieverRequest =
      process === 1
        ? {
            characterId,
            characterProfile,
            process: 1,
            events: Array.isArray(body.events) ? (body.events as string[]) : [],
            actions: Array.isArray(body.actions) ? (body.actions as Action[]) : [],
          }
        : {
            characterId,
            characterProfile,
            process: 2,
          };

    await runMemoryRetriever(req);

    return createResponse(200, { ok: true });
  } catch (error) {
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
};
