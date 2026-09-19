// -------------------------------------------------------
// Lambda ハンドラー: POST /absence-simulator
// エントリーポイント。リクエストを受け取り runAbsenceSimulator を呼ぶ。
// -------------------------------------------------------

import { runAbsenceSimulator } from "../absenceSimulator/index.js";
import { loadRequestedPackage } from "../lib/packages.js";
import { createResponse, parseRequestBody } from "../lib/utils.js";
import type { AbsenceSimulatorRequest } from "../types.js";

export const handler = async (event: unknown): Promise<unknown> => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event);

    const characterId = body.characterId as string | undefined;
    if (!characterId) {
      return createResponse(400, { error: "characterId is required" });
    }

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    const lastLoginAtDate = body.lastLoginAt
      ? new Date(body.lastLoginAt as string)
      : nowDate;

    if (isNaN(nowDate.getTime()) || isNaN(lastLoginAtDate.getTime())) {
      return createResponse(400, { error: "invalid lastLoginAt or now format" });
    }

    if (nowDate.getTime() < lastLoginAtDate.getTime()) {
      return createResponse(400, {
        error: "lastLoginAt must not be later than now",
      });
    }

    const pkg = await loadRequestedPackage(body.packageId);
    if (!pkg) {
      return createResponse(400, { error: "unknown packageId" });
    }

    const req: AbsenceSimulatorRequest = {
      characterId,
      world: pkg.world,
      character: pkg.character,
      lifestyle: pkg.lifestyle,
      lastLoginAt: lastLoginAtDate.toISOString(),
      now: nowDate.toISOString(),
    };

    const result = await runAbsenceSimulator(req);

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
