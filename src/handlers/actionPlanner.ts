// -------------------------------------------------------
// Lambda ハンドラー: POST /action-planner
// エントリーポイント。リクエストを受け取り runActionPlanner を呼ぶ。
// -------------------------------------------------------

import { runActionPlanner } from "../actionPlanner/index.js";
import { loadRequestedPackage } from "../lib/packages.js";
import { createResponse, parseRequestBody } from "../lib/utils.js";
import type { ActionPlannerRequest } from "../types.js";

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

    const pkg = await loadRequestedPackage(body.packageId);
    if (!pkg) {
      return createResponse(400, { error: "unknown packageId" });
    }

    const req: ActionPlannerRequest = {
      characterId,
      world: pkg.world,
      character: pkg.character,
      lastLoginAt: lastLoginAtDate.toISOString(),
      now: nowDate.toISOString(),
      events: Array.isArray(body.events) ? (body.events as string[]) : [],
    };

    const result = await runActionPlanner(req);

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
