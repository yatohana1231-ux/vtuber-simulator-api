// -------------------------------------------------------
// Lambda ハンドラー: POST /memory-retriever
// エントリーポイント。リクエストを受け取り runMemoryRetriever を呼ぶ。
// -------------------------------------------------------

import { runMemoryRetriever } from "../memoryRetriever/index.js";
import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
} from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import type { MemoryRetrieverRequest } from "../types.js";

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);

    const process = body.process as 1 | 2 | undefined;
    if (process !== 1 && process !== 2) {
      throw new BadRequestError("process must be 1 or 2");
    }

    const pkg = await requirePackage(body.packageId);
    const { world, character } = pkg;

    const req: MemoryRetrieverRequest =
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
          };

    await runMemoryRetriever(req);

    return createResponse(200, { ok: true });
  });
