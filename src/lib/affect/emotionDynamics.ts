// -------------------------------------------------------
// 情動（短期）の減衰・加算・活動中の情動（D-040）
//
// LLM も DB も使わない純粋な関数。引数のオブジェクトは書き換えず、
// 新しいオブジェクトを返す。値は丸めず小数のまま扱う（丸めるのは affectText.ts）。
// -------------------------------------------------------

import { EMOTION_KEYS, type EmotionKey, type Emotions, type EmotionImpulse } from "../../types.js";
import { DEFAULT_AFFECT_CONFIG, type AffectConfig, type AffectProfile } from "./affectConfig.js";

/** 0〜100 に収める */
function clampIntensity(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** すべて 0 の情動 */
export function createNeutralEmotions(): Emotions {
  const emotions = {} as Emotions;
  for (const key of EMOTION_KEYS) {
    emotions[key] = 0;
  }
  return emotions;
}

/**
 * 情動を経過時間ぶん減衰させる（値 × 0.5^(経過時間 / (半減期 × emotionHalfLifeScale))）。
 * elapsedHours が 0 以下なら変えない。0.01 未満になったら 0 にする。
 */
export function decayEmotions(
  emotions: Emotions,
  elapsedHours: number,
  profile: AffectProfile,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): Emotions {
  const result = { ...emotions };
  if (elapsedHours <= 0) return result;

  for (const key of EMOTION_KEYS) {
    const halfLife = config.emotion.halfLifeHours[key] * profile.emotionHalfLifeScale;
    const decayed = emotions[key] * Math.pow(0.5, elapsedHours / halfLife);
    result[key] = decayed < 0.01 ? 0 : decayed;
  }
  return result;
}

/**
 * 情動への加算を確率的な和（noisy-OR）で合わせる: 今の強さ e（0〜100）に強さ i の加算が来たら、
 * 100 × (1 − (1 − e/100) × (1 − i/100))。複数の加算は順に当てる（積なので順番によらない）。
 * i は 0〜100 に収めてから使う。LLM が1つの発言から複数の出来事を取り出しても、同じ情動を
 * 何重にも数えないため（2026-09-19 に stg の確認で、ほめ言葉1回で情動が 100 に張り付いたのを直した）。
 */
export function applyEmotionImpulses(emotions: Emotions, impulses: EmotionImpulse[]): Emotions {
  const result = { ...emotions };
  for (const impulse of impulses) {
    const current = clampIntensity(result[impulse.emotion]) / 100;
    const intensity = clampIntensity(impulse.intensity) / 100;
    result[impulse.emotion] = clampIntensity(100 * (1 - (1 - current) * (1 - intensity)));
  }
  return result;
}

/** activeThreshold 以上の情動を、強い順に並べて返す */
export function getActiveEmotions(
  emotions: Emotions,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): Array<{ emotion: EmotionKey; intensity: number }> {
  return EMOTION_KEYS.filter((key) => emotions[key] >= config.emotion.activeThreshold)
    .map((key) => ({ emotion: key, intensity: emotions[key] }))
    .sort((a, b) => b.intensity - a.intensity);
}
