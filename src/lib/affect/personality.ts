// -------------------------------------------------------
// 性格（bigFive・affectTuning）→ AffectProfile（D-040）
//
// キャラクター定義（content/characters/*.json）の bigFive・affectTuning
// から、lib/affect/ の各計算が受け取る AffectProfile を組み立てる。
// LLM も DB も使わない純粋な関数（引数を書き換えず、新しいオブジェクトを返す）。
// -------------------------------------------------------

import type { AffectConfig, AffectProfile } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG } from "./affectConfig.js";
import type { AttachmentStyle, BigFive, CharacterDefinition, CharacterGoal, MoodPad } from "../../types.js";

const DEFAULT_BIG_FIVE: BigFive = {
  openness: 0,
  conscientiousness: 0,
  extraversion: 0,
  agreeableness: 0,
  neuroticism: 0,
};

/** -100〜+100 に収める */
function clampAxis(value: number): number {
  return Math.min(100, Math.max(-100, value));
}

/** 倍率の下限（0.1）に収める */
function clampGain(value: number): number {
  return Math.max(0.1, value);
}

/**
 * 気分の平常値。Mehrabian（1996）の式（ALMA と同じ）。
 * 原典の式の N は情緒安定性（高いほど安定）だが、このプロジェクトの
 * neuroticism（高いほど不安定）に合わせて、あらかじめ符号を反転した
 * 係数にしてある（README の「personality.ts」節の式のとおり）。
 */
function computeMoodHomeBaseFromBigFive(bigFive: BigFive): MoodPad {
  const { openness: O, conscientiousness: C, extraversion: E, agreeableness: A, neuroticism: N } = bigFive;
  return {
    pleasure: clampAxis(0.21 * E + 0.59 * A - 0.19 * N),
    arousal: clampAxis(0.15 * O + 0.3 * A + 0.57 * N),
    dominance: clampAxis(0.25 * O + 0.17 * C + 0.6 * E - 0.32 * A),
  };
}

export function resolveAffectProfile(
  character: CharacterDefinition,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): AffectProfile {
  const bigFive = character.bigFive ?? DEFAULT_BIG_FIVE;
  const affectTuning = character.affectTuning ?? {};

  const moodHomeBase: MoodPad = affectTuning.moodHomeBase ?? computeMoodHomeBaseFromBigFive(bigFive);

  const positiveEmotionGain = clampGain(
    (1 + config.emotion.extraversionPositiveGain * (bigFive.extraversion / 100)) *
      (affectTuning.positiveEmotionGain ?? 1)
  );
  const negativeEmotionGain = clampGain(
    (1 + config.emotion.neuroticismNegativeGain * (bigFive.neuroticism / 100)) *
      (affectTuning.negativeEmotionGain ?? 1)
  );

  const goals: CharacterGoal[] = character.goals ?? [];
  const attachmentStyle: AttachmentStyle = character.attachmentStyle ?? "secure";

  return {
    moodHomeBase,
    positiveEmotionGain,
    negativeEmotionGain,
    emotionHalfLifeScale: affectTuning.emotionHalfLifeScale ?? 1,
    moodHalfLifeScale: affectTuning.moodHalfLifeScale ?? 1,
    lonelinessGrowthScale: affectTuning.lonelinessGrowthScale ?? 1,
    perceptionGainScale: affectTuning.perceptionGainScale ?? 1,
    perceptionDampingSigma: affectTuning.perceptionDampingSigma ?? config.perception.dampingSigma,
    goals,
    attachmentStyle,
  };
}
