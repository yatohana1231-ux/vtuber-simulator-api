// -------------------------------------------------------
// 関係値（Perception）の計算（D-040）
//
// 発言1回ぶんの寄与の計算、関係の段階が変わったときの「下端」の管理、
// 差分の適用（段階ごとの上限・釣り鐘の減衰）、familiarity の減衰を持つ。
// LLM も DB も使わない純粋な関数（引数を書き換えず、新しいオブジェクトを返す）。
// 値は内部では小数のまま持ち、丸めない（README 参照）。
// -------------------------------------------------------

import type { AffectConfig, AffectProfile } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG, PERCEPTION_KEYS, POSITIVE_EMOTION_KEYS, NEGATIVE_EMOTION_KEYS } from "./affectConfig.js";
import type {
  EmotionImpulse,
  EmotionKey,
  InteractionLabels,
  Perception,
  PerceptionContribution,
  PerceptionStageBase,
  RelationshipStage,
} from "../../types.js";

/** emotionKeys に含まれる情動の強さの合計 */
function sumIntensity(impulses: EmotionImpulse[], emotionKeys: ReadonlyArray<EmotionKey>): number {
  return impulses
    .filter((impulse) => emotionKeys.includes(impulse.emotion))
    .reduce((sum, impulse) => sum + impulse.intensity, 0);
}

/** value が 0 でなければ result[key] に入れる（0 の軸は書かない） */
function setIfNonZero(result: PerceptionContribution, key: keyof Perception, value: number): void {
  if (value !== 0) {
    result[key] = value;
  }
}

/**
 * 最初の段階が firstStageFactor、最後の段階が 1 になる係数（間は直線）。
 * 段階が1つ（stageCount <= 1）なら 1。
 */
function stageFactor(firstStageFactor: number, stageIndex: number, stageCount: number): number {
  if (stageCount <= 1) return 1;
  const t = stageIndex / (stageCount - 1);
  return firstStageFactor + (1 - firstStageFactor) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 釣り鐘（正規分布）の右半分の減衰。position は 0〜1（0 = 減衰なし） */
function gaussianDamping(position: number, sigma: number): number {
  return Math.exp(-(position * position) / (2 * sigma * sigma));
}

/**
 * 発言1回ぶんの、関係値への寄与（負の重みはここではかけない。
 * 適用時に applyPerceptionDelta が negativeWeight をかける）。
 */
export function computeMessageContribution(
  args: {
    impulses: EmotionImpulse[];
    interaction: InteractionLabels | null;
    stageIndex: number;
    stageCount: number;
  },
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): PerceptionContribution {
  const { impulses, interaction, stageIndex, stageCount } = args;
  const c = config.perception.contribution;
  const result: PerceptionContribution = {};

  const playerImpulses = impulses.filter((impulse) => impulse.cause === "player");

  // affection: プレイヤーが原因の正の情動の合計 − 負の情動の合計
  // （sympathy は POSITIVE/NEGATIVE のどちらにも含まれないので数えない。
  //  happyFor は POSITIVE_EMOTION_KEYS に含まれるので数える）
  const positiveSum = sumIntensity(playerImpulses, POSITIVE_EMOTION_KEYS);
  const negativeSum = sumIntensity(playerImpulses, NEGATIVE_EMOTION_KEYS);
  setIfNonZero(result, "affection", ((positiveSum - negativeSum) / 100) * c.affectionPerPlayerCausedEmotion);

  // trust: 4つの原因（応じ方2種・話題を覚えていたか・感謝）
  let trust = 0;
  if (interaction) {
    if (interaction.responseToCharacterDisclosure === "responsive") trust += c.trustResponsive;
    if (interaction.responseToCharacterDisclosure === "dismissive") trust += c.trustDismissive;
    if (interaction.rememberedPastTopic) trust += c.trustRememberedPastTopic;
  }
  const gratitudeSum = sumIntensity(playerImpulses, ["gratitude"]);
  trust += (gratitudeSum / 100) * c.trustPerGratitude;
  setIfNonZero(result, "trust", trust);

  // respect: プレイヤーが原因の感心
  const admirationSum = sumIntensity(playerImpulses, ["admiration"]);
  setIfNonZero(result, "respect", (admirationSum / 100) * c.respectPerAdmiration);

  // fear: プレイヤーが原因の強い負の情動があれば上がる。無く、正の情動があれば少し下がる
  const strongNegativeSum = playerImpulses
    .filter(
      (impulse) =>
        (impulse.emotion === "anger" || impulse.emotion === "sadness") &&
        impulse.intensity >= c.fearNegativeEmotionThreshold
    )
    .reduce((sum, impulse) => sum + impulse.intensity, 0);
  let fear = 0;
  if (strongNegativeSum > 0) {
    fear = (strongNegativeSum / 100) * c.fearPerPlayerCausedNegativeEmotion;
  } else if (playerImpulses.some((impulse) => POSITIVE_EMOTION_KEYS.includes(impulse.emotion))) {
    fear = c.fearReliefPerPositiveMessage;
  }
  setIfNonZero(result, "fear", fear);

  // dependence: 困っているときに助けてもらえたら（段階が浅いほど係数が小さい）
  if (interaction?.helpedCharacter) {
    const factor = stageFactor(c.dependenceFirstStageFactor, stageIndex, stageCount);
    setIfNonZero(result, "dependence", c.dependenceHelped * factor);
  }

  // familiarity: 発言そのもの＋自己開示のぶん
  if (interaction) {
    let familiarity = c.familiarityPerMessage;
    if (interaction.playerSelfDisclosure === "fact") familiarity += c.familiarityFactDisclosure;
    if (interaction.playerSelfDisclosure === "emotion") familiarity += c.familiarityEmotionDisclosure;
    setIfNonZero(result, "familiarity", familiarity);
  }

  return result;
}

/**
 * 段階の「下端」（釣り鐘の減衰の基準になる、その段階に入ったときの関係値）。
 * base が無いか段階が違えば、今の関係値で作り直す。同じなら base のまま。
 */
export function resolveStageBase(
  base: PerceptionStageBase | null,
  stageKey: string,
  perception: Perception
): PerceptionStageBase {
  if (base === null || base.stageKey !== stageKey) {
    return { stageKey, values: { ...perception } };
  }
  return base;
}

/**
 * 関係値の差分を反映する。段階ごとの上限（無ければ100）があり、上限の手前ほど
 * 上がりづらくなる（釣り鐘の右半分の減衰）。段階が下がって上限を超えている値は
 * 削らない（それ以上上がらないだけ）。負の差分は negativeWeight をかけ、
 * 段階の下端より下がっているときだけ同様に鈍る。下限は1。
 */
export function applyPerceptionDelta(
  args: {
    perception: Perception;
    delta: PerceptionContribution;
    stage: RelationshipStage;
    stageBase: Perception;
    profile: AffectProfile;
  },
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): Perception {
  const { perception, delta, stage, stageBase, profile } = args;
  const sigma = profile.perceptionDampingSigma;
  const result: Perception = { ...perception };

  for (const key of PERCEPTION_KEYS) {
    const d = delta[key];
    if (d === undefined || d === 0) continue;

    const current = perception[key];
    const base = stageBase[key];

    if (d > 0) {
      const max = stage.maxPerception?.[key] ?? 100;
      if (current >= max) continue; // 上限を超えている値は削らない・変えない

      const p = max <= base ? 1 : clamp01((current - base) / (max - base));
      const added = d * config.perception.gainScale * profile.perceptionGainScale * gaussianDamping(p, sigma);
      result[key] = Math.min(max, current + added);
    } else {
      const weighted = d * config.perception.negativeWeight;

      if (current < base) {
        const q = base <= 1 ? 1 : clamp01((base - current) / (base - 1));
        result[key] = Math.max(1, current + weighted * gaussianDamping(q, sigma));
      } else {
        result[key] = Math.max(1, current + weighted);
      }
    }
  }

  return result;
}

/** 話さない日数が familiarityDecayAfterDays を超えたぶんだけ familiarity を下げる（下限1） */
export function decayFamiliarity(
  familiarity: number,
  elapsedDays: number,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): number {
  const excessDays = elapsedDays - config.perception.familiarityDecayAfterDays;
  if (excessDays <= 0) return familiarity;
  return Math.max(1, familiarity - excessDays * config.perception.familiarityDecayPerDay);
}
