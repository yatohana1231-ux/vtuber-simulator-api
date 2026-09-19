// -------------------------------------------------------
// LLM の出力（出来事の評価）の検証と、OCC の表による情動への変換（D-040）
//
// parseEmotionUpdaterModelOutput: emotionUpdater が Bedrock から受け取った
// JSON（unknown）を検証し、Appraisal[]・InteractionLabels に直す。
// 例外は投げず、おかしな値は無視して warnings に項目名と値を残す
// （console.warn は呼ばない。ログに出すかどうかは呼び出し側の責務。D-037 と同じ考え方）。
//
// appraisalsToEmotionImpulses: 検証済みの Appraisal[] を、OCC（Ortony, Clore &
// Collins）の評価の次元の表にしたがって EmotionImpulse[] に変換する（LLM も DB も使わない純粋な関数）。
// -------------------------------------------------------

import type {
  Appraisal,
  AppraisalCause,
  AppraisalProspect,
  CharacterGoal,
  EmotionImpulse,
  EmotionKey,
  InteractionLabels,
} from "../../types.js";
import {
  DEFAULT_AFFECT_CONFIG,
  NEGATIVE_EMOTION_KEYS,
  POSITIVE_EMOTION_KEYS,
  type AffectConfig,
  type AffectProfile,
} from "./affectConfig.js";

// -------------------------------------------------------
// parseEmotionUpdaterModelOutput
// -------------------------------------------------------

export interface ParsedEmotionUpdaterModelOutput {
  appraisals: Appraisal[];
  interaction: InteractionLabels | null;
  warnings: string[];
}

const PROSPECTS: readonly AppraisalProspect[] = ["happened", "anticipated", "avoided", "missed"];
const CAUSES: readonly AppraisalCause[] = ["player", "self", "other", "circumstance"];

const DEFAULT_INTERACTION: InteractionLabels = {
  playerSelfDisclosure: "none",
  responseToCharacterDisclosure: "not_applicable",
  helpedCharacter: false,
  rememberedPastTopic: false,
};

const SELF_DISCLOSURE_VALUES: readonly InteractionLabels["playerSelfDisclosure"][] = [
  "none",
  "fact",
  "emotion",
];

const RESPONSE_TO_DISCLOSURE_VALUES: readonly InteractionLabels["responseToCharacterDisclosure"][] = [
  "not_applicable",
  "responsive",
  "neutral",
  "dismissive",
];

/** 検証前の JSON（何が来るか分からない unknown）を、モデルの応答から検証済みの形に直す */
export function parseEmotionUpdaterModelOutput(
  raw: unknown,
  goals: CharacterGoal[],
  process: 1 | 2
): ParsedEmotionUpdaterModelOutput {
  const warnings: string[] = [];

  const rawObj = isPlainObject(raw) ? raw : null;
  const rawAppraisals = rawObj !== null && Array.isArray(rawObj.appraisals) ? rawObj.appraisals : [];

  const appraisals: Appraisal[] = [];
  for (const [index, item] of rawAppraisals.slice(0, 3).entries()) {
    const parsed = parseAppraisal(item, index, goals, warnings);
    if (parsed !== null) appraisals.push(parsed);
  }

  const interaction = process === 2 ? parseInteraction(rawObj?.interaction, warnings) : null;

  return { appraisals, interaction, warnings };
}

function parseAppraisal(
  item: unknown,
  index: number,
  goals: CharacterGoal[],
  warnings: string[]
): Appraisal | null {
  if (!isPlainObject(item)) {
    warnings.push(`appraisals[${index}] がオブジェクトでないため、この評価を無視します: ${describe(item)}`);
    return null;
  }

  const prospectRaw = item.prospect;
  if (!isOneOf(prospectRaw, PROSPECTS)) {
    warnings.push(
      `appraisals[${index}].prospect が不正な値のため、この評価を無視します: ${describe(prospectRaw)}`
    );
    return null;
  }

  const causeRaw = item.cause;
  if (!isOneOf(causeRaw, CAUSES)) {
    warnings.push(`appraisals[${index}].cause が不正な値のため、この評価を無視します: ${describe(causeRaw)}`);
    return null;
  }

  const desirabilityForSelf = parseScoreField(
    item.desirabilityForSelf,
    `appraisals[${index}].desirabilityForSelf`,
    warnings
  );
  const desirabilityForPlayer = parseScoreField(
    item.desirabilityForPlayer,
    `appraisals[${index}].desirabilityForPlayer`,
    warnings
  );
  const praiseworthiness = parseScoreField(
    item.praiseworthiness,
    `appraisals[${index}].praiseworthiness`,
    warnings
  );
  const summary = typeof item.summary === "string" ? item.summary : "";
  const relatedGoalKey = parseRelatedGoalKey(item.relatedGoalKey, index, goals, warnings);

  return {
    summary,
    desirabilityForSelf,
    desirabilityForPlayer,
    prospect: prospectRaw,
    cause: causeRaw,
    praiseworthiness,
    relatedGoalKey,
  };
}

/**
 * -3〜+3 の整数の項目（desirabilityForSelf・desirabilityForPlayer・praiseworthiness）を検証する。
 * - 省略（undefined）は「変化なし」の正常なケースなので 0 を返し、警告しない。
 * - 有限の数値なら四捨五入して -3〜+3 に収める（範囲外は黙ってクランプする。警告しない）。
 * - それ以外（文字列・NaN・Infinity・真偽値・null・オブジェクト等）は 0 にして警告する。
 */
function parseScoreField(raw: unknown, label: string, warnings: string[]): number {
  if (raw === undefined) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clamp(Math.round(raw), -3, 3);
  }
  warnings.push(`${label} が不正な値のため無視します（0 として扱う）: ${describe(raw)}`);
  return 0;
}

/**
 * relatedGoalKey を検証する。
 * - 省略（undefined）・null は正常なケース（関係する目標が無い）なので null を返し、警告しない。
 * - goals に見つかる文字列ならそのまま使う。
 * - それ以外（goals に無い文字列・文字列でない値）は null にして警告する。
 */
function parseRelatedGoalKey(
  raw: unknown,
  index: number,
  goals: CharacterGoal[],
  warnings: string[]
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && goals.some((goal) => goal.key === raw)) return raw;
  warnings.push(
    `appraisals[${index}].relatedGoalKey が未知の値のため無視します（null として扱う）: ${describe(raw)}`
  );
  return null;
}

/**
 * interaction を検証する（process=2 のときだけ呼ばれる）。
 * - raw が無い・オブジェクトでなければ、すべて既定値にする（警告しない。process=2 でも
 *   モデルが interaction 自体を省略することは正常な応答として扱う）。
 * - raw がオブジェクトのときは項目ごとに見る。省略（undefined）は既定値で警告しない。
 *   値があるのに決まった型・値でなければ既定値にして警告する。
 */
function parseInteraction(raw: unknown, warnings: string[]): InteractionLabels {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_INTERACTION };
  }

  let playerSelfDisclosure = DEFAULT_INTERACTION.playerSelfDisclosure;
  if (raw.playerSelfDisclosure !== undefined) {
    if (isOneOf(raw.playerSelfDisclosure, SELF_DISCLOSURE_VALUES)) {
      playerSelfDisclosure = raw.playerSelfDisclosure;
    } else {
      warnings.push(
        `interaction.playerSelfDisclosure が不正な値のため既定値にします: ${describe(raw.playerSelfDisclosure)}`
      );
    }
  }

  let responseToCharacterDisclosure = DEFAULT_INTERACTION.responseToCharacterDisclosure;
  if (raw.responseToCharacterDisclosure !== undefined) {
    if (isOneOf(raw.responseToCharacterDisclosure, RESPONSE_TO_DISCLOSURE_VALUES)) {
      responseToCharacterDisclosure = raw.responseToCharacterDisclosure;
    } else {
      warnings.push(
        `interaction.responseToCharacterDisclosure が不正な値のため既定値にします: ${describe(
          raw.responseToCharacterDisclosure
        )}`
      );
    }
  }

  let helpedCharacter = DEFAULT_INTERACTION.helpedCharacter;
  if (raw.helpedCharacter !== undefined) {
    if (typeof raw.helpedCharacter === "boolean") {
      helpedCharacter = raw.helpedCharacter;
    } else {
      warnings.push(`interaction.helpedCharacter が不正な値のため既定値にします: ${describe(raw.helpedCharacter)}`);
    }
  }

  let rememberedPastTopic = DEFAULT_INTERACTION.rememberedPastTopic;
  if (raw.rememberedPastTopic !== undefined) {
    if (typeof raw.rememberedPastTopic === "boolean") {
      rememberedPastTopic = raw.rememberedPastTopic;
    } else {
      warnings.push(
        `interaction.rememberedPastTopic が不正な値のため既定値にします: ${describe(raw.rememberedPastTopic)}`
      );
    }
  }

  return { playerSelfDisclosure, responseToCharacterDisclosure, helpedCharacter, rememberedPastTopic };
}

// -------------------------------------------------------
// appraisalsToEmotionImpulses
// -------------------------------------------------------

/** 検証済みの評価から、OCC の表にしたがって情動への加算（EmotionImpulse）を作る */
export function appraisalsToEmotionImpulses(
  appraisals: Appraisal[],
  profile: AffectProfile,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): EmotionImpulse[] {
  return appraisals.flatMap((appraisal) => appraisalToImpulses(appraisal, profile, config));
}

function appraisalToImpulses(appraisal: Appraisal, profile: AffectProfile, config: AffectConfig): EmotionImpulse[] {
  const { desirabilityForSelf: ds, desirabilityForPlayer: dp, praiseworthiness: pw, prospect, cause, relatedGoalKey, summary } =
    appraisal;
  const importance = resolveGoalImportance(relatedGoalKey, profile.goals, config);
  const impulses: EmotionImpulse[] = [];

  const add = (emotion: EmotionKey, points: number) => {
    impulses.push({
      emotion,
      intensity: computeIntensity(points, emotion, importance, profile, config),
      cause,
      summary,
    });
  };

  // 自分にとっての望ましさ（ds）と prospect
  switch (prospect) {
    case "happened":
      if (ds > 0) add("joy", ds);
      else if (ds < 0) add("sadness", -ds);
      break;
    case "anticipated":
      if (ds > 0) add("hope", ds);
      else if (ds < 0) add("anxiety", -ds);
      break;
    case "avoided":
      add("relief", Math.max(Math.abs(ds), 1));
      break;
    case "missed":
      add("disappointment", Math.max(Math.abs(ds), 1));
      break;
  }

  // 行いの評価（praiseworthiness）。prospect が happened のときだけ
  if (prospect === "happened") {
    if (cause === "self") {
      if (pw > 0) add("pride", pw);
      else if (pw < 0) add("shame", -pw);
    } else if (cause === "player" || cause === "other") {
      if (pw > 0) {
        add("admiration", pw);
        if (ds > 0) add("gratitude", ds);
      } else if (pw < 0) {
        const angerPoints = ds >= 0 ? Math.abs(pw) : Math.max(Math.abs(pw), Math.abs(ds));
        add("anger", angerPoints);
      }
    }
    // cause: circumstance のときは行いの情動を出さない
  }

  // プレイヤーにとっての望ましさ（dp）
  if (dp > 0) add("happyFor", dp);
  else if (dp < 0) add("sympathy", -dp);

  return impulses;
}

/** relatedGoalKey から目標の重要度を引く。無ければ既定の重要度 */
function resolveGoalImportance(relatedGoalKey: string | null, goals: CharacterGoal[], config: AffectConfig): number {
  if (relatedGoalKey === null) return config.emotion.defaultGoalImportance;
  const goal = goals.find((g) => g.key === relatedGoalKey);
  return goal ? goal.importance : config.emotion.defaultGoalImportance;
}

/** 強さ = |点数| × intensityPerPoint ×（0.5 + 重要度/100）× 感じやすさ */
function computeIntensity(
  points: number,
  emotion: EmotionKey,
  importance: number,
  profile: AffectProfile,
  config: AffectConfig
): number {
  return Math.abs(points) * config.emotion.intensityPerPoint * (0.5 + importance / 100) * emotionGain(emotion, profile);
}

/** 感じやすさ。sympathy は 1、正の情動は positiveEmotionGain、負の情動は negativeEmotionGain、それ以外は 1 */
function emotionGain(emotion: EmotionKey, profile: AffectProfile): number {
  if (emotion === "sympathy") return 1;
  if ((POSITIVE_EMOTION_KEYS as readonly EmotionKey[]).includes(emotion)) return profile.positiveEmotionGain;
  if ((NEGATIVE_EMOTION_KEYS as readonly EmotionKey[]).includes(emotion)) return profile.negativeEmotionGain;
  return 1;
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

/** value がプレーンなオブジェクト（null・配列・プリミティブではない）かどうか */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 警告メッセージに埋め込む値の文字列化（循環参照等で JSON.stringify が失敗しても落ちない） */
function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
