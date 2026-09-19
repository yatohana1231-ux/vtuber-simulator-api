// -------------------------------------------------------
// Lambda ハンドラー: POST /dialogue-generator
// エントリーポイント。リクエストを受け取り runDialogueGenerator を呼ぶ。
// -------------------------------------------------------

import { runDialogueGenerator } from "../dialogueGenerator/index.js";
import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
} from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import type { DialogueGeneratorRequest, Mood, Perception } from "../types.js";

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    if (isNaN(nowDate.getTime())) {
      throw new BadRequestError("invalid now format");
    }

    const pkg = await requirePackage(body.packageId);

    const req: DialogueGeneratorRequest = {
      characterId,
      world: pkg.world,
      character: pkg.character,
      now: nowDate.toISOString(),
      message: (body.message as string) ?? "",
      mood: body.mood as Mood | undefined,
      perception: body.perception as Perception | undefined,
      longTimeFlag: body.longTimeFlag as 0 | 1 | undefined,
    };

    const reply = await runDialogueGenerator(req);

    return createResponse(200, { reply });
  });
