import { describe, it, expect } from "vitest";
import {
  computeMessageContribution,
  resolveStageBase,
  applyPerceptionDelta,
  decayFamiliarity,
} from "../../../../src/lib/affect/perceptionDynamics.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import type {
  EmotionImpulse,
  InteractionLabels,
  Perception,
  PerceptionContribution,
  RelationshipStage,
} from "../../../../src/types.js";

const CONTRIBUTION = DEFAULT_AFFECT_CONFIG.perception.contribution;
const SIGMA = DEFAULT_AFFECT_CONFIG.perception.dampingSigma;
const NEGATIVE_WEIGHT = DEFAULT_AFFECT_CONFIG.perception.negativeWeight;

// ---- テスト用のヘルパー ----

function impulse(overrides: Partial<EmotionImpulse> = {}): EmotionImpulse {
  return {
    emotion: "joy",
    intensity: 50,
    cause: "player",
    summary: "テスト用の出来事",
    ...overrides,
  };
}

function interaction(overrides: Partial<InteractionLabels> = {}): InteractionLabels {
  return {
    playerSelfDisclosure: "none",
    responseToCharacterDisclosure: "not_applicable",
    helpedCharacter: false,
    rememberedPastTopic: false,
    ...overrides,
  };
}

function perception(overrides: Partial<Perception> = {}): Perception {
  return {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 10,
    dependence: 10,
    familiarity: 50,
    ...overrides,
  };
}

function stage(overrides: Partial<RelationshipStage> = {}): RelationshipStage {
  return {
    key: "acquainted",
    label: "顔なじみ",
    description: "顔見知り",
    speechStyle: "丁寧語",
    speechExamples: [],
    promoteWhen: null,
    ...overrides,
  };
}

function profile(overrides: Partial<AffectProfile> = {}): AffectProfile {
  return {
    moodHomeBase: { pleasure: 0, arousal: 0, dominance: 0 },
    positiveEmotionGain: 1,
    negativeEmotionGain: 1,
    emotionHalfLifeScale: 1,
    moodHalfLifeScale: 1,
    lonelinessGrowthScale: 1,
    perceptionGainScale: 1,
    perceptionDampingSigma: SIGMA,
    goals: [],
    attachmentStyle: "secure",
    ...overrides,
  };
}

/** 軸が書かれていなければ0として扱う（0を書くか省略するかは実装依存のため） */
function axis(contribution: PerceptionContribution, key: keyof Perception): number {
  return contribution[key] ?? 0;
}

describe("computeMessageContribution", () => {
  describe("affection", () => {
    it("cause: player の正負の情動が相殺される", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "joy", intensity: 60, cause: "player" }),
          impulse({ emotion: "sadness", intensity: 20, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo(
        ((60 - 20) / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion
      );
    });

    it("cause が player 以外の情動は数えない", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "joy", intensity: 60, cause: "self" }),
          impulse({ emotion: "sadness", intensity: 20, cause: "other" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBe(0);
    });

    it("cause: player の happyFor は正の情動として数える", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "happyFor", intensity: 50, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo((50 / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion);
    });

    it("cause: player の sympathy は affection に数えない", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "sympathy", intensity: 80, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBe(0);
    });

    it("同じ種類の正の情動が複数件 → 合計ではなく最大の1件で決まる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "joy", intensity: 55, cause: "player" }),
          impulse({ emotion: "joy", intensity: 40, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo((55 / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion);
    });

    it("種類をまたいだ正の情動が複数件 → 合計ではなく最大の1件で決まる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "joy", intensity: 55, cause: "player" }),
          impulse({ emotion: "gratitude", intensity: 60, cause: "player" }),
          impulse({ emotion: "admiration", intensity: 45, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo((60 / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion);
    });

    it("正と負が両方あるときは、それぞれの最大どうしの差になる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "joy", intensity: 55, cause: "player" }),
          impulse({ emotion: "admiration", intensity: 40, cause: "player" }),
          impulse({ emotion: "sadness", intensity: 30, cause: "player" }),
          impulse({ emotion: "anger", intensity: 20, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo(((55 - 30) / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion);
    });

    it("強さが100を超える加算があっても、100を上限にして使う", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "joy", intensity: 150, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "affection")).toBeCloseTo((100 / 100) * CONTRIBUTION.affectionPerPlayerCausedEmotion);
    });
  });

  describe("trust", () => {
    it("responseToCharacterDisclosure が responsive → trustResponsive ぶん上がる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ responseToCharacterDisclosure: "responsive" }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo(CONTRIBUTION.trustResponsive);
    });

    it("responseToCharacterDisclosure が dismissive → trustDismissive ぶん下がる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ responseToCharacterDisclosure: "dismissive" }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo(CONTRIBUTION.trustDismissive);
    });

    it("rememberedPastTopic が true → trustRememberedPastTopic ぶん上がる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ rememberedPastTopic: true }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo(CONTRIBUTION.trustRememberedPastTopic);
    });

    it("cause: player の gratitude → 強さ/100 × trustPerGratitude ぶん上がる", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "gratitude", intensity: 50, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo((50 / 100) * CONTRIBUTION.trustPerGratitude);
    });

    it("cause: player の gratitude が複数件 → 合計ではなく最大の1件で決まる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "gratitude", intensity: 30, cause: "player" }),
          impulse({ emotion: "gratitude", intensity: 55, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo((55 / 100) * CONTRIBUTION.trustPerGratitude);
    });

    it("gratitude の強さが100を超えても、100を上限にして使う", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "gratitude", intensity: 140, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "trust")).toBeCloseTo((100 / 100) * CONTRIBUTION.trustPerGratitude);
    });
  });

  describe("respect", () => {
    it("cause: player の admiration → 強さ/100 × respectPerAdmiration ぶん上がる", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "admiration", intensity: 60, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "respect")).toBeCloseTo((60 / 100) * CONTRIBUTION.respectPerAdmiration);
    });

    it("cause が player 以外の admiration は数えない", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "admiration", intensity: 60, cause: "other" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "respect")).toBe(0);
    });

    it("cause: player の admiration が複数件 → 合計ではなく最大の1件で決まる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "admiration", intensity: 60, cause: "player" }),
          impulse({ emotion: "admiration", intensity: 45, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "respect")).toBeCloseTo((60 / 100) * CONTRIBUTION.respectPerAdmiration);
    });

    it("admiration の強さが100を超えても、100を上限にして使う", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "admiration", intensity: 130, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "respect")).toBeCloseTo((100 / 100) * CONTRIBUTION.respectPerAdmiration);
    });
  });

  describe("fear", () => {
    it("しきい値以上の cause: player の anger → 強さ/100 × fearPerPlayerCausedNegativeEmotion ぶん上がる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "anger", intensity: 60, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBeCloseTo((60 / 100) * CONTRIBUTION.fearPerPlayerCausedNegativeEmotion);
    });

    it("しきい値未満の cause: player の負の情動だけでは変わらない", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({
            emotion: "anger",
            intensity: CONTRIBUTION.fearNegativeEmotionThreshold - 1,
            cause: "player",
          }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBe(0);
    });

    it("強い負の情動が無く、cause: player の正の情動があれば fearReliefPerPositiveMessage ぶん下がる", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "joy", intensity: 40, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBeCloseTo(CONTRIBUTION.fearReliefPerPositiveMessage);
    });

    it("強い負の情動と正の情動が両方あるときは、負の情動のほうの規則を使う", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "anger", intensity: 70, cause: "player" }),
          impulse({ emotion: "joy", intensity: 40, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBeCloseTo((70 / 100) * CONTRIBUTION.fearPerPlayerCausedNegativeEmotion);
    });

    it("しきい値以上の cause: player の anger・sadness が複数件 → 合計ではなく最大の1件で決まる", () => {
      const result = computeMessageContribution({
        impulses: [
          impulse({ emotion: "anger", intensity: 60, cause: "player" }),
          impulse({ emotion: "sadness", intensity: 80, cause: "player" }),
        ],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBeCloseTo((80 / 100) * CONTRIBUTION.fearPerPlayerCausedNegativeEmotion);
    });

    it("負の情動の強さが100を超えても、100を上限にして使う", () => {
      const result = computeMessageContribution({
        impulses: [impulse({ emotion: "anger", intensity: 130, cause: "player" })],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "fear")).toBeCloseTo((100 / 100) * CONTRIBUTION.fearPerPlayerCausedNegativeEmotion);
    });
  });

  describe("dependence", () => {
    it("helpedCharacter が true・最初の段階 → dependenceHelped × dependenceFirstStageFactor", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ helpedCharacter: true }),
        stageIndex: 0,
        stageCount: 3,
      });

      expect(axis(result, "dependence")).toBeCloseTo(
        CONTRIBUTION.dependenceHelped * CONTRIBUTION.dependenceFirstStageFactor
      );
    });

    it("helpedCharacter が true・最後の段階 → dependenceHelped そのまま（係数1）", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ helpedCharacter: true }),
        stageIndex: 2,
        stageCount: 3,
      });

      expect(axis(result, "dependence")).toBeCloseTo(CONTRIBUTION.dependenceHelped);
    });

    it("helpedCharacter が false → 変わらない", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ helpedCharacter: false }),
        stageIndex: 0,
        stageCount: 3,
      });

      expect(axis(result, "dependence")).toBe(0);
    });
  });

  describe("familiarity", () => {
    it("playerSelfDisclosure が none → familiarityPerMessage だけ上がる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ playerSelfDisclosure: "none" }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "familiarity")).toBeCloseTo(CONTRIBUTION.familiarityPerMessage);
    });

    it("playerSelfDisclosure が fact → familiarityFactDisclosure ぶん上乗せされる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ playerSelfDisclosure: "fact" }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "familiarity")).toBeCloseTo(
        CONTRIBUTION.familiarityPerMessage + CONTRIBUTION.familiarityFactDisclosure
      );
    });

    it("playerSelfDisclosure が emotion → familiarityEmotionDisclosure ぶん上乗せされる", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: interaction({ playerSelfDisclosure: "emotion" }),
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "familiarity")).toBeCloseTo(
        CONTRIBUTION.familiarityPerMessage + CONTRIBUTION.familiarityEmotionDisclosure
      );
    });

    it("interaction が null → familiarity は変わらない", () => {
      const result = computeMessageContribution({
        impulses: [],
        interaction: null,
        stageIndex: 0,
        stageCount: 1,
      });

      expect(axis(result, "familiarity")).toBe(0);
    });
  });
});

describe("resolveStageBase", () => {
  it("base が null → 今の関係値で作る", () => {
    const current = perception({ trust: 42 });
    const result = resolveStageBase(null, "acquainted", current);

    expect(result.stageKey).toBe("acquainted");
    expect(result.values).toEqual(current);
  });

  it("base が null → 作った values はもとの perception と別のオブジェクト", () => {
    const current = perception();
    const result = resolveStageBase(null, "acquainted", current);

    expect(result.values).not.toBe(current);
  });

  it("段階が同じ → base をそのまま返す（今の関係値では作り直さない）", () => {
    const base = { stageKey: "acquainted", values: perception({ trust: 70 }) };
    const current = perception({ trust: 99 });

    const result = resolveStageBase(base, "acquainted", current);

    expect(result).toBe(base);
    expect(result.values.trust).toBe(70);
  });

  it("段階が違う → 今の関係値で作り直す", () => {
    const base = { stageKey: "first", values: perception({ trust: 10 }) };
    const current = perception({ trust: 55 });

    const result = resolveStageBase(base, "acquainted", current);

    expect(result).not.toBe(base);
    expect(result.stageKey).toBe("acquainted");
    expect(result.values).toEqual(current);
  });
});

describe("applyPerceptionDelta", () => {
  it("p = 0（今の値が下端と同じ）→ 減衰なしで、差分 × 全体の倍率（config.perception.gainScale）が足される", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 50 }),
      delta: { trust: 10 },
      stage: stage(),
      stageBase: perception({ trust: 50 }),
      profile: profile({ perceptionGainScale: 1 }),
    });

    expect(result.trust).toBeCloseTo(50 + 10 * DEFAULT_AFFECT_CONFIG.perception.gainScale);
  });

  it("全体の倍率（config.perception.gainScale）を変える → 足される量がその倍率になる", () => {
    const config = {
      ...DEFAULT_AFFECT_CONFIG,
      perception: { ...DEFAULT_AFFECT_CONFIG.perception, gainScale: 0.5 },
    };

    const result = applyPerceptionDelta(
      {
        perception: perception({ trust: 50 }),
        delta: { trust: 10 },
        stage: stage(),
        stageBase: perception({ trust: 50 }),
        profile: profile({ perceptionGainScale: 1 }),
      },
      config
    );

    expect(result.trust).toBeCloseTo(55);
  });

  it("p が大きいほど、足される量が単調に小さくなる", () => {
    const base = 0;
    const max = 100;
    const delta = 10;

    const added = [20, 50, 80].map((p) => {
      const current = base + (p / 100) * (max - base);
      const result = applyPerceptionDelta({
        perception: perception({ trust: current }),
        delta: { trust: delta },
        stage: stage(),
        stageBase: perception({ trust: base }),
        profile: profile(),
      });
      return result.trust - current;
    });

    expect(added[0]).toBeGreaterThan(added[1]);
    expect(added[1]).toBeGreaterThan(added[2]);
  });

  it("上限の手前（p≈0.95）では、p=0のときの15%未満になる（σが既定値のとき）", () => {
    const base = 0;
    const max = 100;
    const delta = 10;

    const atZero = applyPerceptionDelta({
      perception: perception({ trust: base }),
      delta: { trust: delta },
      stage: stage(),
      stageBase: perception({ trust: base }),
      profile: profile({ perceptionDampingSigma: SIGMA }),
    });
    const addedAtZero = atZero.trust - base;

    const currentNear = base + 0.95 * (max - base);
    const atNearMax = applyPerceptionDelta({
      perception: perception({ trust: currentNear }),
      delta: { trust: delta },
      stage: stage(),
      stageBase: perception({ trust: base }),
      profile: profile({ perceptionDampingSigma: SIGMA }),
    });
    const addedAtNearMax = atNearMax.trust - currentNear;

    expect(addedAtNearMax).toBeLessThan(addedAtZero * 0.15);
  });

  it("上限で収まる（大きな差分でも上限を超えない）", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 90 }),
      delta: { trust: 1_000_000 },
      stage: stage({ maxPerception: { trust: 100 } }),
      stageBase: perception({ trust: 0 }),
      profile: profile(),
    });

    expect(result.trust).toBe(100);
  });

  it("上限以上の値は変わらない（削らない）", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 120 }),
      delta: { trust: 10 },
      stage: stage({ maxPerception: { trust: 100 } }),
      stageBase: perception({ trust: 0 }),
      profile: profile(),
    });

    expect(result.trust).toBe(120);
  });

  it("上限 ≤ 下端のとき → p = 1 として減衰する", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 30 }),
      delta: { trust: 10 },
      stage: stage({ maxPerception: { trust: 50 } }),
      stageBase: perception({ trust: 80 }), // 下端(80) >= 上限(50)
      profile: profile({ perceptionDampingSigma: SIGMA }),
    });

    const expectedAdded = 10 * DEFAULT_AFFECT_CONFIG.perception.gainScale * Math.exp(-1 / (2 * SIGMA * SIGMA));
    expect(result.trust).toBeCloseTo(30 + expectedAdded, 6);
  });

  it("maxPerception に無い軸は上限100として扱う", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 99 }),
      delta: { trust: 1_000_000 },
      stage: stage({ maxPerception: {} }),
      stageBase: perception({ trust: 0 }),
      profile: profile(),
    });

    expect(result.trust).toBe(100);
  });

  it("perceptionGainScale が大きいほど、足される量も大きくなる", () => {
    const args = {
      perception: perception({ trust: 50 }),
      delta: { trust: 10 } as PerceptionContribution,
      stage: stage(),
      stageBase: perception({ trust: 50 }),
    };

    const withGain1 = applyPerceptionDelta({ ...args, profile: profile({ perceptionGainScale: 1 }) });
    const withGain2 = applyPerceptionDelta({ ...args, profile: profile({ perceptionGainScale: 2 }) });

    expect(withGain2.trust - 50).toBeCloseTo((withGain1.trust - 50) * 2);
  });

  it("perceptionDampingSigma が大きいほど、上限に近い位置での減衰が弱くなる（足される量が大きくなる）", () => {
    const current = 80; // 下端0・上限100 のとき p = 0.8
    const args = {
      perception: perception({ trust: current }),
      delta: { trust: 10 } as PerceptionContribution,
      stage: stage(),
      stageBase: perception({ trust: 0 }),
    };

    const withSmallSigma = applyPerceptionDelta({ ...args, profile: profile({ perceptionDampingSigma: 0.3 }) });
    const withLargeSigma = applyPerceptionDelta({ ...args, profile: profile({ perceptionDampingSigma: 1.0 }) });

    expect(withLargeSigma.trust - current).toBeGreaterThan(withSmallSigma.trust - current);
  });

  it("負の差分に negativeWeight がかかる（下端以上のときは減衰なし）", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 60 }),
      delta: { trust: -10 },
      stage: stage(),
      stageBase: perception({ trust: 50 }), // 今の値(60) >= 下端(50)
      profile: profile(),
    });

    expect(result.trust).toBeCloseTo(60 - 10 * NEGATIVE_WEIGHT);
  });

  it("下端以上では減衰しない（negativeWeight をかけた値がそのまま足される）", () => {
    const result1 = applyPerceptionDelta({
      perception: perception({ trust: 50 }), // 下端と同じ
      delta: { trust: -10 },
      stage: stage(),
      stageBase: perception({ trust: 50 }),
      profile: profile(),
    });
    const result2 = applyPerceptionDelta({
      perception: perception({ trust: 90 }), // 下端よりかなり上
      delta: { trust: -10 },
      stage: stage(),
      stageBase: perception({ trust: 50 }),
      profile: profile(),
    });

    expect(result1.trust).toBeCloseTo(50 - 10 * NEGATIVE_WEIGHT);
    expect(result2.trust).toBeCloseTo(90 - 10 * NEGATIVE_WEIGHT);
  });

  it("下端より下では、負の差分が鈍る（減衰なしの場合より下がり方が小さい）", () => {
    const current = 40;
    const base = 50;
    const undampedDrop = 10 * NEGATIVE_WEIGHT;

    const result = applyPerceptionDelta({
      perception: perception({ trust: current }),
      delta: { trust: -10 },
      stage: stage(),
      stageBase: perception({ trust: base }),
      profile: profile(),
    });

    const actualDrop = current - result.trust;
    expect(actualDrop).toBeLessThan(undampedDrop);
    expect(actualDrop).toBeGreaterThan(0);
  });

  it("下限は1（負の差分で1を下回らない）", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 2 }),
      delta: { trust: -100 },
      stage: stage(),
      stageBase: perception({ trust: 0 }), // 今の値(2) >= 下端(0) なので減衰なし
      profile: profile(),
    });

    expect(result.trust).toBe(1);
  });

  it("下端 ≤ 1 のとき → 0除算にならず、下限1に収まった有限の値を返す", () => {
    // 下端(1) <= 1 のとき、素朴に q = (下端 − 今の値) / (下端 − 1) を計算すると
    // 分母が0になる（今の値はすでに下端未満＝1未満なので、この経路は必ず下限1に
    // clamp される。q = 1 として扱う特別扱いが無いと NaN/Infinity になりうる）。
    const result = applyPerceptionDelta({
      perception: perception({ trust: 0.5 }),
      delta: { trust: -10 },
      stage: stage(),
      stageBase: perception({ trust: 1 }), // 下端(1) <= 1、今の値(0.5) < 下端
      profile: profile({ perceptionDampingSigma: SIGMA }),
    });

    expect(Number.isFinite(result.trust)).toBe(true);
    expect(result.trust).toBe(1);
  });

  it("delta に無い軸は変わらない", () => {
    const original = perception({ trust: 50, affection: 33, respect: 20, fear: 5, dependence: 15, familiarity: 60 });
    const result = applyPerceptionDelta({
      perception: original,
      delta: { trust: 10 },
      stage: stage(),
      stageBase: perception({ trust: 50 }),
      profile: profile(),
    });

    expect(result.affection).toBe(original.affection);
    expect(result.respect).toBe(original.respect);
    expect(result.fear).toBe(original.fear);
    expect(result.dependence).toBe(original.dependence);
    expect(result.familiarity).toBe(original.familiarity);
  });

  it("小数のまま返る（丸めない）", () => {
    const result = applyPerceptionDelta({
      perception: perception({ trust: 50 }),
      delta: { trust: 1 },
      stage: stage(),
      stageBase: perception({ trust: 0 }), // p = 0.5
      profile: profile({ perceptionDampingSigma: SIGMA }),
    });

    expect(Number.isInteger(result.trust)).toBe(false);
  });

  it("引数を書き換えない", () => {
    const originalPerception = perception({ trust: 50 });
    const perceptionSnapshot = { ...originalPerception };
    const delta: PerceptionContribution = { trust: 10, familiarity: -5 };
    const deltaSnapshot = { ...delta };
    const originalStageBase = perception({ trust: 40 });
    const stageBaseSnapshot = { ...originalStageBase };
    const originalProfile = profile();
    const profileSnapshot = { ...originalProfile };
    const stageArg = stage({ maxPerception: { trust: 90 } });
    const stageSnapshot = { ...stageArg };

    applyPerceptionDelta({
      perception: originalPerception,
      delta,
      stage: stageArg,
      stageBase: originalStageBase,
      profile: originalProfile,
    });

    expect(originalPerception).toEqual(perceptionSnapshot);
    expect(delta).toEqual(deltaSnapshot);
    expect(originalStageBase).toEqual(stageBaseSnapshot);
    expect(originalProfile).toEqual(profileSnapshot);
    expect(stageArg).toEqual(stageSnapshot);
  });
});

describe("decayFamiliarity", () => {
  const AFTER_DAYS = DEFAULT_AFFECT_CONFIG.perception.familiarityDecayAfterDays;
  const PER_DAY = DEFAULT_AFFECT_CONFIG.perception.familiarityDecayPerDay;

  it("経過日数がしきい値以下 → 変わらない", () => {
    expect(decayFamiliarity(50, AFTER_DAYS)).toBe(50);
    expect(decayFamiliarity(50, AFTER_DAYS - 5)).toBe(50);
  });

  it("しきい値を超えたぶんだけ引く", () => {
    const result = decayFamiliarity(50, AFTER_DAYS + 5);
    expect(result).toBeCloseTo(50 - 5 * PER_DAY);
  });

  it("下限は1", () => {
    const result = decayFamiliarity(1.5, AFTER_DAYS + 100000);
    expect(result).toBe(1);
  });
});
