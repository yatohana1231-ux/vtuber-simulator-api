// -------------------------------------------------------
// emotionUpdater 向けのルールによる判定（D-040 フェーズ16b）。
//
// runEmotionUpdater は { emotions, mood(PAD), needs, perception } を返すが、判定は
// 主に RunResult.preAffectState/postAffectState（実行前後の完全な状態。execute.ts が組み立てる）
// と、LLM が出した評価（Bedrock の最後の応答から invokeModelJson と同じ抽出方法で読み、
// parseEmotionUpdaterModelOutput で検証したもの）を見る。関係値（perception）は発言では
// 変わらず、セッションが終わったときにだけ反映される（README 参照）ため、
// 「pendingSession への寄与」と「セッション確定時の反映」を別の判定にしている。
// -------------------------------------------------------

import { parseEmotionUpdaterModelOutput, type ParsedEmotionUpdaterModelOutput } from "../../../../src/lib/affect/appraisal.js";
import { PERCEPTION_KEYS } from "../../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS } from "../../../../src/types.js";
import type { AppraisalCause, EmotionKey, InteractionLabels, MoodPad, Perception } from "../../../../src/types.js";
import type { RunResult } from "../types.js";
import { extractJsonFromText } from "./text.js";
import type { CheckContext, CheckFn, CheckOutcome } from "./types.js";

type Direction = "up" | "down" | "flat" | "notDown" | "notUp";
const DIRECTIONS: readonly Direction[] = ["up", "down", "flat", "notDown", "notUp"];

/**
 * delta の向きが direction と合っているか。flatEpsilon を指定しなければ「flat」は
 * 厳密に 0（pendingSession の寄与・確定後の関係値のように、動いていなければ正確に 0 になる値向け）。
 * flatEpsilon を指定すると |delta| < flatEpsilon を「flat」とみなす（mood の PAD のように、
 * 連続値でほぼ動いていないことを見たいときに使う）。
 */
function directionOk(delta: number, direction: Direction, flatEpsilon = 0): boolean {
  switch (direction) {
    case "up":
      return delta > 0;
    case "down":
      return delta < 0;
    case "flat":
      return flatEpsilon > 0 ? Math.abs(delta) < flatEpsilon : delta === 0;
    case "notDown":
      return delta >= 0;
    case "notUp":
      return delta <= 0;
  }
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function readDirectionMap(value: unknown): Record<string, Direction> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, Direction> = {};
  for (const [key, raw] of entries) {
    if (!isDirection(raw)) return null;
    result[key] = raw;
  }
  return result;
}

function readEmotionKeys(value: unknown): EmotionKey[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => (EMOTION_KEYS as readonly string[]).includes(v as string))) return null;
  return value as EmotionKey[];
}

const APPRAISAL_CAUSES: readonly AppraisalCause[] = ["player", "self", "other", "circumstance"];

function readCauses(value: unknown): AppraisalCause[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => (APPRAISAL_CAUSES as readonly string[]).includes(v as string))) return null;
  return value as AppraisalCause[];
}

// -------------------------------------------------------
// LLM の出力（検証後）を読む
// -------------------------------------------------------

function getProcess(context: CheckContext): 1 | 2 {
  const req = context.resolvedScenario.request as { process?: 1 | 2 };
  return req.process === 2 ? 2 : 1;
}

function parseModelOutputOrFail(
  result: RunResult,
  context: CheckContext
): { ok: true; value: ParsedEmotionUpdaterModelOutput } | { ok: false; outcome: CheckOutcome } {
  const lastCall = result.modelCalls[result.modelCalls.length - 1];
  if (!lastCall) {
    return { ok: false, outcome: { passed: false, detail: "Bedrock の呼び出しが無い" } };
  }
  const extracted = extractJsonFromText(lastCall.responseText);
  if (!extracted.ok) {
    return { ok: false, outcome: { passed: false, detail: extracted.reason } };
  }
  const goals = context.character.goals ?? [];
  const value = parseEmotionUpdaterModelOutput(extracted.value, goals, getProcess(context));
  return { ok: true, value };
}

/**
 * judge.ts から使う（採点の入力に、検証済みの LLM の出力〔appraisals・interaction〕を載せるため）。
 * Bedrock の呼び出しが無い、または応答から JSON が読めないときは null。
 */
export function getParsedModelOutput(result: RunResult, context: CheckContext): ParsedEmotionUpdaterModelOutput | null {
  const parsed = parseModelOutputOrFail(result, context);
  return parsed.ok ? parsed.value : null;
}

// -------------------------------------------------------
// 判定
// -------------------------------------------------------

/** 挙げた情動のどれかが、実行前より 1 以上強くなった */
export const emotionTriggered: CheckFn = (result, _context, params) => {
  const anyOf = readEmotionKeys(params?.anyOf);
  if (!anyOf) return { passed: false, detail: "params.anyOf が不正（EmotionKey の配列が必要）" };
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };

  const before = result.preAffectState.emotions;
  const after = result.postAffectState.emotions;
  const triggered = anyOf.filter((k) => after[k] - before[k] >= 1);
  return {
    passed: triggered.length > 0,
    detail:
      triggered.length > 0
        ? undefined
        : `いずれも1以上強くなっていない: ${anyOf.map((k) => `${k}(${before[k]}→${after[k]})`).join(", ")}`,
  };
};

/** 挙げた情動のどれも、実行前より 1 以上強くなっていない */
export const emotionNotTriggered: CheckFn = (result, _context, params) => {
  const noneOf = readEmotionKeys(params?.noneOf);
  if (!noneOf) return { passed: false, detail: "params.noneOf が不正（EmotionKey の配列が必要）" };
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };

  const before = result.preAffectState.emotions;
  const after = result.postAffectState.emotions;
  const triggered = noneOf.filter((k) => after[k] - before[k] >= 1);
  return {
    passed: triggered.length === 0,
    detail:
      triggered.length > 0
        ? `強くなってはいけない情動が強くなった: ${triggered.map((k) => `${k}(${before[k]}→${after[k]})`).join(", ")}`
        : undefined,
  };
};

const MOOD_AXES: readonly (keyof MoodPad)[] = ["pleasure", "arousal", "dominance"];
const MOOD_FLAT_EPSILON = 0.5;

/** 気分の各軸の変化の向きが期待どおり（flat は絶対値 0.5 未満） */
export const moodDirection: CheckFn = (result, _context, params) => {
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };
  const expect = readDirectionMap(params?.expect);
  if (!expect) return { passed: false, detail: "params.expect が不正（Record<pleasure/arousal/dominance, 方向> が必要）" };

  const before = result.preAffectState.mood;
  const after = result.postAffectState.mood;
  const violations: string[] = [];
  for (const [axis, direction] of Object.entries(expect)) {
    if (!(MOOD_AXES as readonly string[]).includes(axis)) {
      violations.push(`不正な軸: "${axis}"（pleasure/arousal/dominance のいずれかが必要）`);
      continue;
    }
    const key = axis as keyof MoodPad;
    const delta = after[key] - before[key];
    if (!directionOk(delta, direction, MOOD_FLAT_EPSILON)) {
      violations.push(`${axis}: ${before[key].toFixed(1)} → ${after[key].toFixed(1)}（差分 ${delta.toFixed(1)}）、期待は ${direction}`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

/** 検証後の appraisals の件数が範囲内 */
export const appraisalCount: CheckFn = (result, context, params) => {
  const parsed = parseModelOutputOrFail(result, context);
  if (!parsed.ok) return parsed.outcome;

  const min = typeof params?.min === "number" ? params.min : 0;
  const max = typeof params?.max === "number" ? params.max : Infinity;
  const count = parsed.value.appraisals.length;
  const passed = count >= min && count <= max;
  return { passed, detail: passed ? undefined : `appraisals の件数 ${count} が範囲外（min=${min}, max=${max}）` };
};

/** 評価のどれかの cause が anyOf に入る／どの評価の cause も noneOf に入らない */
export const appraisalCause: CheckFn = (result, context, params) => {
  const parsed = parseModelOutputOrFail(result, context);
  if (!parsed.ok) return parsed.outcome;

  const anyOf = readCauses(params?.anyOf);
  const noneOf = readCauses(params?.noneOf);
  if (!anyOf && !noneOf) {
    return { passed: false, detail: "params.anyOf または params.noneOf が不正（AppraisalCause の配列が必要）" };
  }

  const causes = parsed.value.appraisals.map((a) => a.cause);
  if (anyOf) {
    const passed = causes.some((c) => anyOf.includes(c));
    return {
      passed,
      detail: passed ? undefined : `cause がいずれも含まれない: ${anyOf.join(", ")}（実際: ${causes.join(", ") || "評価なし"}）`,
    };
  }
  const hits = causes.filter((c) => noneOf!.includes(c));
  return { passed: hits.length === 0, detail: hits.length > 0 ? `含まれてはいけない cause が含まれる: ${hits.join(", ")}` : undefined };
};

const INTERACTION_FIELDS: readonly (keyof InteractionLabels)[] = [
  "playerSelfDisclosure",
  "responseToCharacterDisclosure",
  "helpedCharacter",
  "rememberedPastTopic",
];

/** interaction のその項目が、許す値のどれか */
export const interactionLabel: CheckFn = (result, context, params) => {
  const field = params?.field;
  if (typeof field !== "string" || !(INTERACTION_FIELDS as readonly string[]).includes(field)) {
    return { passed: false, detail: `params.field が不正: ${String(field)}（${INTERACTION_FIELDS.join("/")} のいずれかが必要）` };
  }
  const expect = params?.expect;
  if (!Array.isArray(expect) || expect.length === 0) {
    return { passed: false, detail: "params.expect が不正（空でない配列が必要）" };
  }

  const parsed = parseModelOutputOrFail(result, context);
  if (!parsed.ok) return parsed.outcome;

  if (!parsed.value.interaction) {
    return { passed: false, detail: "interaction が無い（process=1、またはモデルの出力から読めなかった）" };
  }

  const actual = (parsed.value.interaction as unknown as Record<string, unknown>)[field];
  const passed = expect.some((v) => v === actual);
  return { passed, detail: passed ? undefined : `interaction.${field} = ${String(actual)}（期待: ${expect.join(", ")}）` };
};

/** postAffectState.pendingSession.last の各軸の向きが期待どおり（pendingSession が無ければ不合格） */
export const pendingContribution: CheckFn = (result, _context, params) => {
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };
  const pending = result.postAffectState.pendingSession;
  if (!pending) return { passed: false, detail: "pendingSession が無い" };

  const expect = readDirectionMap(params?.expect);
  if (!expect) return { passed: false, detail: "params.expect が不正（Record<関係値の軸, 方向> が必要）" };

  const last = pending.last as Partial<Record<string, number>>;
  const violations: string[] = [];
  for (const [key, direction] of Object.entries(expect)) {
    if (!(PERCEPTION_KEYS as readonly string[]).includes(key)) {
      violations.push(`不正な項目: "${key}"`);
      continue;
    }
    const value = last[key] ?? 0;
    if (!directionOk(value, direction)) {
      violations.push(`${key}: last=${value}、期待は ${direction}`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

/** pendingSession が実行前と同じ（process=1 用） */
export const pendingSessionUntouched: CheckFn = (result) => {
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };
  const before = result.preAffectState.pendingSession;
  const after = result.postAffectState.pendingSession;
  const passed = JSON.stringify(before) === JSON.stringify(after);
  return {
    passed,
    detail: passed ? undefined : `pendingSession が変化した: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  };
};

/** perception の全軸が実行前と同じ（差の絶対値 0.001 未満） */
export const perceptionUnchanged: CheckFn = (result) => {
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };
  const before = result.preAffectState.perception;
  const after = result.postAffectState.perception;
  const violations = (PERCEPTION_KEYS as readonly (keyof Perception)[]).filter(
    (key) => Math.abs(after[key] - before[key]) >= 0.001
  );
  return {
    passed: violations.length === 0,
    detail:
      violations.length > 0
        ? `関係値が変化した: ${violations.map((k) => `${k}(${before[k]}→${after[k]})`).join(", ")}`
        : undefined,
  };
};

/**
 * セッションの確定で関係値が期待の向きに動き、pendingSession が新しいセッション（または null）に
 * なったこと。セッションの確定は、実行前の pendingSession が存在し（そうでなければ確定のしようが
 * ない）、実行後は null になった、または startedAt が変わった（確定後にこの発言で新しいセッションが
 * 始まった）ことで見分ける。
 */
export const perceptionSettled: CheckFn = (result, _context, params) => {
  if (!result.postAffectState) return { passed: false, detail: "postAffectState が無い" };

  const expect = readDirectionMap(params?.expect);
  if (!expect) return { passed: false, detail: "params.expect が不正（Record<関係値の軸, 方向> が必要）" };
  const max = params?.max;
  if (max !== undefined && typeof max !== "number") {
    return { passed: false, detail: "params.max は数値である必要があります" };
  }

  const beforePending = result.preAffectState.pendingSession;
  const afterPending = result.postAffectState.pendingSession;
  const settled = beforePending !== null && (afterPending === null || afterPending.startedAt !== beforePending.startedAt);
  if (!settled) {
    return {
      passed: false,
      detail: "セッションが確定していない（実行前に pendingSession が無い、または実行後も同じセッションのまま）",
    };
  }

  const before = result.preAffectState.perception;
  const after = result.postAffectState.perception;
  const violations: string[] = [];
  for (const [key, direction] of Object.entries(expect)) {
    if (!(PERCEPTION_KEYS as readonly string[]).includes(key)) {
      violations.push(`不正な項目: "${key}"`);
      continue;
    }
    const k = key as keyof Perception;
    const delta = after[k] - before[k];
    if (!directionOk(delta, direction)) {
      violations.push(`${key}: ${before[k].toFixed(2)} → ${after[k].toFixed(2)}（差分 ${delta.toFixed(2)}）、期待は ${direction}`);
      continue;
    }
    if (typeof max === "number" && Math.abs(delta) > max) {
      violations.push(`${key}: 差分 ${Math.abs(delta).toFixed(2)} が上限 ${max} を超えている`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};
