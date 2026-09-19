// -------------------------------------------------------
// emotionUpdater 向けのルールによる判定。
// runEmotionUpdater は { mood, perception } を返す。変化は、シナリオの state に
// 書いた値（省略時は DEFAULT_MOOD/DEFAULT_PERCEPTION）との差で見る。
// -------------------------------------------------------

import type { EmotionUpdaterResponse, Mood, Perception } from "../../../../src/types.js";
import type { CheckFn, CheckOutcome } from "./types.js";
import { DEFAULT_MOOD, DEFAULT_PERCEPTION } from "../../../../src/lib/dynamo.js";

type Direction = "up" | "down" | "flat" | "notDown" | "notUp";
const DIRECTIONS: readonly Direction[] = ["up", "down", "flat", "notDown", "notUp"];

function getOutput(
  output: unknown
): { ok: true; value: EmotionUpdaterResponse } | { ok: false; outcome: CheckOutcome } {
  const v = output as Partial<EmotionUpdaterResponse> | undefined;
  if (!v || typeof v.mood !== "object" || v.mood === null || typeof v.perception !== "object" || v.perception === null) {
    return { ok: false, outcome: { passed: false, detail: "output に mood/perception が無い" } };
  }
  return { ok: true, value: v as EmotionUpdaterResponse };
}

function directionOk(delta: number, direction: Direction): boolean {
  switch (direction) {
    case "up":
      return delta > 0;
    case "down":
      return delta < 0;
    case "flat":
      return delta === 0;
    case "notDown":
      return delta >= 0;
    case "notUp":
      return delta <= 0;
  }
}

export const deltaDirection: CheckFn = (result, context, params) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const expect = params?.expect;
  if (typeof expect !== "object" || expect === null || Array.isArray(expect)) {
    return { passed: false, detail: "params.expect が不正（Record<string, 方向> が必要）" };
  }

  const baseMood: Mood = context.resolvedScenario.state?.mood ?? DEFAULT_MOOD;
  const basePerception: Perception = context.resolvedScenario.state?.perception ?? DEFAULT_PERCEPTION;

  const violations: string[] = [];
  for (const [path, rawDirection] of Object.entries(expect as Record<string, unknown>)) {
    const [group, key] = path.split(".");
    if ((group !== "mood" && group !== "perception") || !key) {
      violations.push(`不正なキー: "${path}"（"mood.joy" のような形が必要）`);
      continue;
    }
    if (typeof rawDirection !== "string" || !DIRECTIONS.includes(rawDirection as Direction)) {
      violations.push(`${path}: 不正な向き "${String(rawDirection)}"`);
      continue;
    }
    const baseObj = (group === "mood" ? baseMood : basePerception) as unknown as Record<string, number>;
    const outObj = (group === "mood" ? output.value.mood : output.value.perception) as unknown as Record<
      string,
      number
    >;
    if (!(key in baseObj) || !(key in outObj)) {
      violations.push(`${path}: 未知の項目`);
      continue;
    }
    const before = baseObj[key];
    const after = outObj[key];
    const delta = after - before;
    if (!directionOk(delta, rawDirection as Direction)) {
      violations.push(`${path}: ${before} → ${after}（差分 ${delta}）、期待は ${rawDirection}`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

export const deltaWithin: CheckFn = (result, context, params) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const path = params?.path;
  const max = params?.max;
  if ((path !== "mood" && path !== "perception") || typeof max !== "number") {
    return { passed: false, detail: 'params.path が "mood"/"perception" ではない、または params.max が数値ではない' };
  }

  const baseObj = (
    path === "mood"
      ? context.resolvedScenario.state?.mood ?? DEFAULT_MOOD
      : context.resolvedScenario.state?.perception ?? DEFAULT_PERCEPTION
  ) as unknown as Record<string, number>;
  const outObj = (path === "mood" ? output.value.mood : output.value.perception) as unknown as Record<
    string,
    number
  >;

  const violations: string[] = [];
  for (const key of Object.keys(outObj)) {
    const before = baseObj[key];
    const after = outObj[key];
    if (typeof before !== "number") continue;
    const diff = Math.abs(after - before);
    if (diff > max) {
      violations.push(`${path}.${key}: 差分 ${diff} が上限 ${max} を超えている`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};
