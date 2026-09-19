// -------------------------------------------------------
// 気分（中期）の平常値への回帰・情動による押し引き・8象限のラベル（D-040）
//
// LLM も DB も使わない純粋な関数。引数のオブジェクトは書き換えず、
// 新しいオブジェクトを返す。値は丸めず小数のまま扱う（丸めるのは affectText.ts）。
// -------------------------------------------------------

import { EMOTION_KEYS, type Emotions, type MoodPad, type Needs } from "../../types.js";
import { DEFAULT_AFFECT_CONFIG, type AffectConfig, type AffectProfile } from "./affectConfig.js";

/** 気分の8象限（原点付近は describeMood が別途 "neutral" を返す） */
export type MoodOctant =
  | "exuberant"
  | "bored"
  | "dependent"
  | "disdainful"
  | "relaxed"
  | "anxious"
  | "docile"
  | "hostile";

/** -100〜+100 に収める */
function clampAxis(value: number): number {
  return Math.min(100, Math.max(-100, value));
}

function clampMoodPad(mood: MoodPad): MoodPad {
  return {
    pleasure: clampAxis(mood.pleasure),
    arousal: clampAxis(mood.arousal),
    dominance: clampAxis(mood.dominance),
  };
}

function moodMagnitude(mood: MoodPad): number {
  return Math.sqrt(mood.pleasure ** 2 + mood.arousal ** 2 + mood.dominance ** 2);
}

/** 欲求（疲労・孤独感）で平常値をずらす */
export function computeEffectiveHomeBase(
  profile: AffectProfile,
  needs: Needs,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): MoodPad {
  const { moodHomeBase } = profile;
  return clampMoodPad({
    pleasure: moodHomeBase.pleasure + (config.mood.pleasureOffsetAtFullLoneliness * needs.loneliness) / 100,
    arousal: moodHomeBase.arousal + (config.mood.arousalOffsetAtFullFatigue * needs.fatigue) / 100,
    dominance: moodHomeBase.dominance,
  });
}

/** 気分を（欲求でずらした）平常値へ、軸ごとに経過時間ぶん戻す */
export function decayMoodTowardHomeBase(
  mood: MoodPad,
  homeBase: MoodPad,
  elapsedHours: number,
  profile: AffectProfile,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): MoodPad {
  const halfLife = config.mood.halfLifeHours * profile.moodHalfLifeScale;
  const decayRatio = Math.pow(0.5, elapsedHours / halfLife);

  const axes: Array<keyof MoodPad> = ["pleasure", "arousal", "dominance"];
  const result = {} as MoodPad;
  for (const axis of axes) {
    result[axis] = homeBase[axis] + (mood[axis] - homeBase[axis]) * decayRatio;
  }
  return clampMoodPad(result);
}

/**
 * 活動中の情動による気分の押し引き（ALMA の pull-push）。
 * 活動中の情動が無ければ変えない。情動の中心（PAD 座標の強さ重み付き平均）の
 * 向きに、中心までの距離を超えなければ引き寄せ（中心を通り越さない）、
 * 超えていればさらに押し出す。
 */
export function applyPullPush(
  mood: MoodPad,
  emotions: Emotions,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): MoodPad {
  const active = EMOTION_KEYS.filter((key) => emotions[key] >= config.emotion.activeThreshold);
  if (active.length === 0) return { ...mood };

  let weightSum = 0;
  const center: MoodPad = { pleasure: 0, arousal: 0, dominance: 0 };
  let intensitySum = 0;

  for (const key of active) {
    const intensity = emotions[key];
    const pad = config.emotion.pad[key];
    center.pleasure += intensity * pad.pleasure;
    center.arousal += intensity * pad.arousal;
    center.dominance += intensity * pad.dominance;
    weightSum += intensity;
    intensitySum += intensity;
  }

  if (weightSum <= 0) return { ...mood };

  center.pleasure /= weightSum;
  center.arousal /= weightSum;
  center.dominance /= weightSum;

  const centerDistance = moodMagnitude(center);
  if (centerDistance < 1e-9) return { ...mood };

  const centerStrength = intensitySum / active.length;
  const step = (config.mood.pullPushStepAtFullIntensity * centerStrength) / 100;

  // 原点から中心への単位ベクトル
  const unit: MoodPad = {
    pleasure: center.pleasure / centerDistance,
    arousal: center.arousal / centerDistance,
    dominance: center.dominance / centerDistance,
  };

  // 気分を中心の向きに射影した長さ
  const projected = mood.pleasure * unit.pleasure + mood.arousal * unit.arousal + mood.dominance * unit.dominance;

  if (projected >= centerDistance) {
    // 押す: すでに中心より外側にいる。中心の向きに、さらに幅のぶん動かす
    return clampMoodPad({
      pleasure: mood.pleasure + unit.pleasure * step,
      arousal: mood.arousal + unit.arousal * step,
      dominance: mood.dominance + unit.dominance * step,
    });
  }

  // 引く: 中心の点に向かって幅のぶん動かす（中心の向きに直交する成分も中心に寄る）。中心は通り越さない
  const toCenter: MoodPad = {
    pleasure: center.pleasure - mood.pleasure,
    arousal: center.arousal - mood.arousal,
    dominance: center.dominance - mood.dominance,
  };
  const distanceToCenter = moodMagnitude(toCenter);
  if (distanceToCenter < 1e-9) return { ...mood };
  const ratio = Math.min(step, distanceToCenter) / distanceToCenter;

  return clampMoodPad({
    pleasure: mood.pleasure + toCenter.pleasure * ratio,
    arousal: mood.arousal + toCenter.arousal * ratio,
    dominance: mood.dominance + toCenter.dominance * ratio,
  });
}

/** 気分を8象限のラベルと強さで説明する */
export function describeMood(
  mood: MoodPad,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): { octant: MoodOctant | "neutral"; strength: "slight" | "moderate" | "strong" } {
  const distance = moodMagnitude(mood);

  if (distance < config.mood.neutralRadius) {
    return { octant: "neutral", strength: "slight" };
  }

  const strength: "slight" | "moderate" | "strong" =
    distance < config.mood.strengthThresholds.moderate
      ? "slight"
      : distance < config.mood.strengthThresholds.strong
        ? "moderate"
        : "strong";

  const positiveP = mood.pleasure >= 0;
  const positiveA = mood.arousal >= 0;
  const positiveD = mood.dominance >= 0;

  let octant: MoodOctant;
  if (positiveP && positiveA && positiveD) octant = "exuberant";
  else if (!positiveP && !positiveA && !positiveD) octant = "bored";
  else if (positiveP && positiveA && !positiveD) octant = "dependent";
  else if (!positiveP && !positiveA && positiveD) octant = "disdainful";
  else if (positiveP && !positiveA && positiveD) octant = "relaxed";
  else if (!positiveP && positiveA && !positiveD) octant = "anxious";
  else if (positiveP && !positiveA && !positiveD) octant = "docile";
  else octant = "hostile"; // !positiveP && positiveA && positiveD

  return { octant, strength };
}
