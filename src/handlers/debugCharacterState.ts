// -------------------------------------------------------
// Lambda ハンドラー: POST /debug-character-state（デバッグ専用）
// エントリーポイント。mood/perception の入力を検証したうえで
// runDebugCharacterState を呼ぶ。有効・無効はステージごとに
// infra/lib/vtuber-simulator-stack.ts（context.enableDebugEndpoints）で切り替える。
// -------------------------------------------------------

import { runDebugCharacterState } from "../debugCharacterState/index.js";
import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
} from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import type { DebugCharacterStateRequest, Mood, Perception } from "../types.js";

const MOOD_KEYS = ["joy", "anxiety", "angry", "fatigue", "confidence", "loneliness"] as const;
const PERCEPTION_KEYS = [
  "trust",
  "affection",
  "respect",
  "fear",
  "dependence",
  "familiarity",
] as const;

/**
 * mood/perception の入力を検証する（.notes/done/debug-character-state-roadmap.md「方針3」）。
 * - `undefined` → 指定なし（`undefined` を返す。もう片方の値をそのまま保存するために使う）
 * - それ以外（`null` を含む）でオブジェクトでない・配列である場合は `BadRequestError`
 * - 6項目ちょうどでない（不足・余分）場合は `BadRequestError`
 * - 各値が数値でない・整数でない・1〜100の範囲外の場合は `BadRequestError`（丸めない。
 *   デバッグでは指定した値そのものを入れたいため）
 */
function validateStateField<K extends string>(
  value: unknown,
  fieldName: string,
  keys: readonly K[]
): Record<K, number> | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError(`${fieldName} must be an object`);
  }

  const obj = value as Record<string, unknown>;
  const objKeys = Object.keys(obj);

  if (objKeys.length !== keys.length || keys.some((key) => !(key in obj))) {
    throw new BadRequestError(`${fieldName} must have exactly the fields: ${keys.join(", ")}`);
  }

  const result = {} as Record<K, number>;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
      throw new BadRequestError(`${fieldName}.${key} must be an integer`);
    }
    if (v < 1 || v > 100) {
      throw new BadRequestError(`${fieldName}.${key} must be between 1 and 100`);
    }
    result[key] = v;
  }

  return result;
}

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);
    const pkg = await requirePackage(body.packageId);
    const { character } = pkg;

    const mood = validateStateField(body.mood, "mood", MOOD_KEYS) as Mood | undefined;
    const perception = validateStateField(
      body.perception,
      "perception",
      PERCEPTION_KEYS
    ) as Perception | undefined;

    const req: DebugCharacterStateRequest = {
      characterId,
      character,
      mood,
      perception,
    };

    const result = await runDebugCharacterState(req);

    return createResponse(200, result);
  });
