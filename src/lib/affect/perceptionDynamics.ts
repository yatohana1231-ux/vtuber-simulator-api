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

/** 強さを 0〜100 に収める（加算の強さが 100 を超えることがあるため） */
function clampIntensity(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * emotionKeys に含まれる情動のうち、いちばん強い1件の強さ（0〜100 に収めてから比べる）。
 * 該当が無ければ 0。合計ではなく最大値にする理由: LLM が1つの発言から複数の出来事を
 * 取り出しても、同じ情動・同じ相手への気持ちを何重にも数えないため（2026-09-19 に stg の
 * 確認で、ほめ言葉1回で好感の寄与が +13.8 になったのを直した）。
 */
function maxIntensity(impulses: EmotionImpulse[], emotionKeys: ReadonlyArray<EmotionKey>): number {
  let max = 0;
  for (const impulse of impulses) {
    if (!emotionKeys.includes(impulse.emotion)) continue;
    const intensity = clampIntensity(impulse.intensity);
    if (intensity > max) max = intensity;
  }
  return max;
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

  // affection: プレイヤーが原因の正の情動のうちいちばん強い1件 − 負の情動のうちいちばん強い1件
  // （合計ではなく最大値にする。sympathy は POSITIVE/NEGATIVE のどちらにも含まれないので数えない。
  //  happyFor は POSITIVE_EMOTION_KEYS に含まれるので数える）
  const positiveMax = maxIntensity(playerImpulses, POSITIVE_EMOTION_KEYS);
  const negativeMax = maxIntensity(playerImpulses, NEGATIVE_EMOTION_KEYS);
  setIfNonZero(result, "affection", ((positiveMax - negativeMax) / 100) * c.affectionPerPlayerCausedEmotion);

  // trust: 4つの原因（応じ方2種・話題を覚えていたか・感謝はいちばん強い1件）
  let trust = 0;
  if (interaction) {
    if (interaction.responseToCharacterDisclosure === "responsive") trust += c.trustResponsive;
    if (interaction.responseToCharacterDisclosure === "dismissive") trust += c.trustDismissive;
    if (interaction.rememberedPastTopic) trust += c.trustRememberedPastTopic;
  }
  const gratitudeMax = maxIntensity(playerImpulses, ["gratitude"]);
  trust += (gratitudeMax / 100) * c.trustPerGratitude;
  setIfNonZero(result, "trust", trust);

  // respect: プレイヤーが原因の感心のうちいちばん強い1件
  const admirationMax = maxIntensity(playerImpulses, ["admiration"]);
  setIfNonZero(result, "respect", (admirationMax / 100) * c.respectPerAdmiration);

  // fear: プレイヤーが原因の怒り・悲しみのうちいちばん強い1件がしきい値以上なら上がる。
  // 無く、正の情動があれば少し下がる
  const negativeEmotionMax = maxIntensity(playerImpulses, ["anger", "sadness"]);
  let fear = 0;
  if (negativeEmotionMax >= c.fearNegativeEmotionThreshold) {
    fear = (negativeEmotionMax / 100) * c.fearPerPlayerCausedNegativeEmotion;
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
