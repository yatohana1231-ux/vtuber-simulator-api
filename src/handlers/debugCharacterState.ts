// -------------------------------------------------------
// Lambda ハンドラー: POST /debug-character-state（デバッグ専用）
// エントリーポイント。emotions/mood/needs/perception の入力を検証したうえで
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
import { EMOTION_KEYS } from "../types.js";
import type { DebugCharacterStateRequest, Emotions, MoodPad, Perception } from "../types.js";

const MOOD_KEYS = ["pleasure", "arousal", "dominance"] as const;
const PERCEPTION_KEYS = [
  "trust",
  "affection",
  "respect",
  "fear",
  "dependence",
  "familiarity",
] as const;

/**
 * emotions/mood/perception の入力を検証する（D-040・D-038「不正な値は丸めずに 400」）。
 * - `undefined` → 指定なし（`undefined` を返す。その見出しは書き換えない）
 * - それ以外（`null` を含む）でオブジェクトでない・配列である場合は `BadRequestError`
 * - `keys` の項目ちょうどでない（不足・余分）場合は `BadRequestError`
 * - 各値が有限の数値でない・`range` の範囲外の場合は `BadRequestError`
 *   （丸めない。小数は可）
 */
function validateFiniteNumberObject<K extends string>(
  value: unknown,
  fieldName: string,
  keys: readonly K[],
  range: { min: number; max: number }
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
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new BadRequestError(`${fieldName}.${key} must be a number`);
    }
    if (v < range.min || v > range.max) {
      throw new BadRequestError(`${fieldName}.${key} must be between ${range.min} and ${range.max}`);
    }
    result[key] = v;
  }

  return result;
}

/**
 * needs は `loneliness` だけを書き換えられる。`fatigue` は生活様式と時刻から
 * 毎回計算し直すので、指定されていても値を検証せず無視する（D-040。
 * `runDebugCharacterState`/`DebugCharacterStateRequest.needs` も loneliness しか
 * 受け取らない）。`loneliness`/`fatigue` 以外の項目が含まれていれば 400。
 */
function validateNeeds(value: unknown): { loneliness: number } | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError("needs must be an object");
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "loneliness" && key !== "fatigue") {
      throw new BadRequestError(`needs has an unknown field: ${key}`);
    }
  }

  if (!("loneliness" in obj)) {
    throw new BadRequestError("needs must include field: loneliness");
  }

  const loneliness = obj.loneliness;
  if (typeof loneliness !== "number" || !Number.isFinite(loneliness)) {
    throw new BadRequestError("needs.loneliness must be a number");
  }
  if (loneliness < 0 || loneliness > 100) {
    throw new BadRequestError("needs.loneliness must be between 0 and 100");
  }

  return { loneliness };
}

export const handler = async (event: unknown) =>
  handleApiRequest(event, async (body) => {
    const characterId = requireCharacterId(body);

    const nowDate = body.now ? new Date(body.now as string) : new Date();
    if (isNaN(nowDate.getTime())) {
      throw new BadRequestError("invalid now format");
    }

    const pkg = await requirePackage(body.packageId);
    const { world, character, lifestyle } = pkg;

    const emotions = validateFiniteNumberObject(body.emotions, "emotions", EMOTION_KEYS, {
      min: 0,
      max: 100,
    }) as Emotions | undefined;
    const mood = validateFiniteNumberObject(body.mood, "mood", MOOD_KEYS, {
      min: -100,
      max: 100,
    }) as MoodPad | undefined;
    const needs = validateNeeds(body.needs);
    const perception = validateFiniteNumberObject(body.perception, "perception", PERCEPTION_KEYS, {
      min: 1,
      max: 100,
    }) as Perception | undefined;

    const req: DebugCharacterStateRequest = {
      characterId,
      world,
      character,
      lifestyle,
      now: nowDate.toISOString(),
      emotions,
      mood,
      needs,
      perception,
    };

    const result = await runDebugCharacterState(req);

    return createResponse(200, result);
  });
