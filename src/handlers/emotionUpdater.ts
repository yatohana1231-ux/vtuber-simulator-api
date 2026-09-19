// -------------------------------------------------------
// Lambda ハンドラー: POST /emotion-updater
// エントリーポイント。リクエストを受け取り runEmotionUpdater を呼ぶ。
// -------------------------------------------------------

import { runEmotionUpdater } from "../emotionUpdater/index.js";
import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
} from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import type { EmotionUpdaterRequest } from "../types.js";

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);

    const process = body.process as 1 | 2 | undefined;
    if (process !== 1 && process !== 2) {
      throw new BadRequestError("process must be 1 or 2");
    }

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    if (isNaN(nowDate.getTime())) {
      throw new BadRequestError("invalid now format");
    }

    const pkg = await requirePackage(body.packageId);
    const { world, character, lifestyle } = pkg;

    const req: EmotionUpdaterRequest =
      process === 1
        ? {
            characterId,
            world,
            character,
            lifestyle,
            now: nowDate.toISOString(),
            process: 1,
          }
        : {
            characterId,
            world,
            character,
            lifestyle,
            now: nowDate.toISOString(),
            process: 2,
            playerMessage: (body.playerMessage as string) ?? "",
          };

    const result = await runEmotionUpdater(req);

    return createResponse(200, result);
  });
