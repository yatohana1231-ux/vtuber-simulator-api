// -------------------------------------------------------
// Lambda ハンドラー: POST /absence-simulator
// エントリーポイント。リクエストを受け取り runAbsenceSimulator を呼ぶ。
// -------------------------------------------------------

import { runAbsenceSimulator } from "../absenceSimulator/index.js";
import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
} from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import type { AbsenceSimulatorRequest } from "../types.js";

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    const lastLoginAtDate = body.lastLoginAt
      ? new Date(body.lastLoginAt as string)
      : nowDate;

    if (isNaN(nowDate.getTime()) || isNaN(lastLoginAtDate.getTime())) {
      throw new BadRequestError("invalid lastLoginAt or now format");
    }

    if (nowDate.getTime() < lastLoginAtDate.getTime()) {
      throw new BadRequestError("lastLoginAt must not be later than now");
    }

    const pkg = await requirePackage(body.packageId);

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
  });
