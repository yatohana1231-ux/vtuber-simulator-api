// -------------------------------------------------------
// Lambda ハンドラー: POST /emotion-updater
// エントリーポイント。リクエストを受け取り runEmotionUpdater を呼ぶ。
// -------------------------------------------------------

import { runEmotionUpdater } from "../emotionUpdater/index.js";
import { loadRequestedPackage } from "../lib/packages.js";
import { createResponse, parseRequestBody } from "../lib/utils.js";
import type { EmotionUpdaterRequest } from "../types.js";

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

    const pkg = await loadRequestedPackage(body.packageId);
    if (!pkg) {
      return createResponse(400, { error: "unknown packageId" });
    }
    const { world, character } = pkg;

    const req: EmotionUpdaterRequest =
      process === 1
        ? {
            characterId,
            world,
            character,
            process: 1,
          }
        : {
            characterId,
            world,
            character,
            process: 2,
            playerMessage: (body.playerMessage as string) ?? "",
          };

    const result = await runEmotionUpdater(req);

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
