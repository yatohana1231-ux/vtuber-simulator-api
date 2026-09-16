// -------------------------------------------------------
// Lambda ハンドラー: POST /dialogue-generator
// エントリーポイント。リクエストを受け取り runDialogueGenerator を呼ぶ。
// -------------------------------------------------------

import { runDialogueGenerator } from "../dialogueGenerator/index.js";
import { createResponse, normalizeProfile, parseRequestBody } from "../lib/utils.js";
import type {
  Action,
  CharacterProfile,
  DialogueGeneratorRequest,
  Mood,
  Perception,
} from "../types.js";

export const handler = async (event: unknown): Promise<unknown> => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event);

    const characterId = body.characterId as string | undefined;
    if (!characterId) {
      return createResponse(400, { error: "characterId is required" });
    }

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    if (isNaN(nowDate.getTime())) {
      return createResponse(400, { error: "invalid now format" });
    }

    const req: DialogueGeneratorRequest = {
      characterId,
      characterProfile: normalizeProfile(
        body.characterProfile as Partial<CharacterProfile> | undefined
      ),
      now: nowDate.toISOString(),
      message: (body.message as string) ?? "",
      mood: body.mood as Mood | undefined,
      perception: body.perception as Perception | undefined,
      events: Array.isArray(body.events) ? (body.events as string[]) : undefined,
      actions: Array.isArray(body.actions) ? (body.actions as Action[]) : undefined,
      longTimeFlag: body.longTimeFlag as 0 | 1 | undefined,
    };

    const reply = await runDialogueGenerator(req);

    return createResponse(200, { reply });
  } catch (error) {
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
};
