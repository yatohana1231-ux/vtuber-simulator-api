import { describe, it, expect } from "vitest";
import { resolveAffectProfile } from "../../../../src/lib/affect/personality.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectConfig } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectTuning, BigFive, CharacterDefinition, CharacterGoal, Perception } from "../../../../src/types.js";

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

function character(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    key: "test-character",
    name: "テストキャラ",
    personality: "テスト用の性格",
    speechStyle: "テスト用の話し方",
    relationship: "テスト用の関係の前提",
    background: "テスト用の背景",
    speechExamples: [],
    initialPerception: perception(),
    relationshipStages: [
      {
        key: "first",
        label: "はじめまして",
        description: "初対面",
        speechStyle: "丁寧語",
        speechExamples: [],
        promoteWhen: null,
      },
    ],
    ...overrides,
  };
}

function bigFive(overrides: Partial<BigFive> = {}): BigFive {
  return {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    neuroticism: 0,
    ...overrides,
  };
}

describe("resolveAffectProfile", () => {
  it("bigFiveを省略 → 気分の平常値はすべて0、正負の情動の倍率は1", () => {
    const profile = resolveAffectProfile(character());

    expect(profile.moodHomeBase).toEqual({ pleasure: 0, arousal: 0, dominance: 0 });
    expect(profile.positiveEmotionGain).toBe(1);
    expect(profile.negativeEmotionGain).toBe(1);
  });

  describe("気分の平常値の式（Mehrabian 1996）", () => {
    it("extraversionのみ100 → pleasureに0.21・dominanceに0.60反映される", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ extraversion: 100 }) }));

      expect(profile.moodHomeBase).toEqual({ pleasure: 21, arousal: 0, dominance: 60 });
    });

    it("agreeablenessのみ100 → pleasureに0.59・arousalに0.30・dominanceに-0.32反映される", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ agreeableness: 100 }) }));

      expect(profile.moodHomeBase).toEqual({ pleasure: 59, arousal: 30, dominance: -32 });
    });

    it("neuroticismのみ100 → pleasureに-0.19・arousalに0.57反映される（符号は快が下がり覚醒が上がる向き）", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ neuroticism: 100 }) }));

      expect(profile.moodHomeBase.pleasure).toBeCloseTo(-19);
      expect(profile.moodHomeBase.arousal).toBeCloseTo(57);
      expect(profile.moodHomeBase.dominance).toBe(0);
      expect(profile.moodHomeBase.pleasure).toBeLessThan(0);
      expect(profile.moodHomeBase.arousal).toBeGreaterThan(0);
    });

    it("opennessのみ100 → arousalに0.15・dominanceに0.25反映される", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ openness: 100 }) }));

      expect(profile.moodHomeBase).toEqual({ pleasure: 0, arousal: 15, dominance: 25 });
    });

    it("conscientiousnessのみ100 → dominanceに0.17反映される", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ conscientiousness: 100 }) }));

      expect(profile.moodHomeBase).toEqual({ pleasure: 0, arousal: 0, dominance: 17 });
    });
  });

  describe("気分の平常値のクランプ（-100〜+100）", () => {
    it("式の結果が100を超える組み合わせ → 100に収まる", () => {
      const profile = resolveAffectProfile(
        character({
          bigFive: bigFive({ openness: 100, agreeableness: 100, neuroticism: 100 }),
        })
      );

      // arousal = 0.15*100 + 0.30*100 + 0.57*100 = 102 → 100に収める
      expect(profile.moodHomeBase.arousal).toBe(100);
    });

    it("式の結果が-100を下回る組み合わせ → -100に収まる", () => {
      const profile = resolveAffectProfile(
        character({
          bigFive: bigFive({ openness: -100, conscientiousness: -100, extraversion: -100, agreeableness: 100 }),
        })
      );

      // dominance = 0.25*(-100) + 0.17*(-100) + 0.60*(-100) - 0.32*100 = -134 → -100に収める
      expect(profile.moodHomeBase.dominance).toBe(-100);
    });
  });

  it("affectTuning.moodHomeBaseがある → bigFiveの式を使わずその値になる", () => {
    const profile = resolveAffectProfile(
      character({
        bigFive: bigFive({ extraversion: 100, agreeableness: 100 }),
        affectTuning: { moodHomeBase: { pleasure: 1, arousal: 2, dominance: 3 } },
      })
    );

    expect(profile.moodHomeBase).toEqual({ pleasure: 1, arousal: 2, dominance: 3 });
  });

  describe("正負の情動の倍率", () => {
    it("extraversionが100 → positiveEmotionGainが1.3になる", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ extraversion: 100 }) }));

      expect(profile.positiveEmotionGain).toBeCloseTo(1.3);
    });

    it("neuroticismが100 → negativeEmotionGainが1.5になる", () => {
      const profile = resolveAffectProfile(character({ bigFive: bigFive({ neuroticism: 100 }) }));

      expect(profile.negativeEmotionGain).toBeCloseTo(1.5);
    });

    it("affectTuning.positiveEmotionGainがある → 式の結果にかけ合わされる", () => {
      const profile = resolveAffectProfile(
        character({
          bigFive: bigFive({ extraversion: 100 }),
          affectTuning: { positiveEmotionGain: 2 },
        })
      );

      // (1 + 0.3*1) * 2 = 2.6
      expect(profile.positiveEmotionGain).toBeCloseTo(2.6);
    });

    it("affectTuning.negativeEmotionGainがある → 式の結果にかけ合わされる", () => {
      const profile = resolveAffectProfile(
        character({
          bigFive: bigFive({ neuroticism: 100 }),
          affectTuning: { negativeEmotionGain: 2 },
        })
      );

      // (1 + 0.5*1) * 2 = 3
      expect(profile.negativeEmotionGain).toBeCloseTo(3);
    });

    it("倍率の計算結果が0.1を下回る → 下限の0.1に収まる（positiveEmotionGain）", () => {
      const profile = resolveAffectProfile(character({ affectTuning: { positiveEmotionGain: 0 } }));

      expect(profile.positiveEmotionGain).toBe(0.1);
    });

    it("倍率の計算結果が0.1を下回る → 下限の0.1に収まる（negativeEmotionGain）", () => {
      const profile = resolveAffectProfile(character({ affectTuning: { negativeEmotionGain: 0 } }));

      expect(profile.negativeEmotionGain).toBe(0.1);
    });
  });

  describe("そのほかのaffectTuningの倍率", () => {
    it("affectTuningを省略 → すべて1になる", () => {
      const profile = resolveAffectProfile(character());

      expect(profile.emotionHalfLifeScale).toBe(1);
      expect(profile.moodHalfLifeScale).toBe(1);
      expect(profile.lonelinessGrowthScale).toBe(1);
      expect(profile.perceptionGainScale).toBe(1);
    });

    it("affectTuningの値がある → そのまま反映される", () => {
      const tuning: AffectTuning = {
        emotionHalfLifeScale: 1.5,
        moodHalfLifeScale: 0.8,
        lonelinessGrowthScale: 1.2,
        perceptionGainScale: 0.9,
      };
      const profile = resolveAffectProfile(character({ affectTuning: tuning }));

      expect(profile.emotionHalfLifeScale).toBe(1.5);
      expect(profile.moodHalfLifeScale).toBe(0.8);
      expect(profile.lonelinessGrowthScale).toBe(1.2);
      expect(profile.perceptionGainScale).toBe(0.9);
    });
  });

  describe("perceptionDampingSigma", () => {
    it("affectTuningを省略 → configのperception.dampingSigmaになる", () => {
      const profile = resolveAffectProfile(character());

      expect(profile.perceptionDampingSigma).toBe(DEFAULT_AFFECT_CONFIG.perception.dampingSigma);
    });

    it("affectTuning.perceptionDampingSigmaがある → その値で上書きされる", () => {
      const profile = resolveAffectProfile(character({ affectTuning: { perceptionDampingSigma: 0.8 } }));

      expect(profile.perceptionDampingSigma).toBe(0.8);
    });
  });

  describe("goals・attachmentStyleの既定値", () => {
    it("goalsを省略 → 空配列になる", () => {
      const profile = resolveAffectProfile(character());

      expect(profile.goals).toEqual([]);
    });

    it("goalsがある → そのまま反映される", () => {
      const goals: CharacterGoal[] = [{ key: "practice", description: "配信の練習を頑張る", importance: 80 }];
      const profile = resolveAffectProfile(character({ goals }));

      expect(profile.goals).toEqual(goals);
    });

    it("attachmentStyleを省略 → secureになる", () => {
      const profile = resolveAffectProfile(character());

      expect(profile.attachmentStyle).toBe("secure");
    });

    it("attachmentStyleがある → そのまま反映される", () => {
      const profile = resolveAffectProfile(character({ attachmentStyle: "anxious" }));

      expect(profile.attachmentStyle).toBe("anxious");
    });
  });

  it("configを差し替える → 係数・既定値に反映される", () => {
    const customConfig: AffectConfig = {
      ...DEFAULT_AFFECT_CONFIG,
      emotion: {
        ...DEFAULT_AFFECT_CONFIG.emotion,
        extraversionPositiveGain: 1,
        neuroticismNegativeGain: 1,
      },
      perception: {
        ...DEFAULT_AFFECT_CONFIG.perception,
        dampingSigma: 0.99,
      },
    };

    const profile = resolveAffectProfile(
      character({ bigFive: bigFive({ extraversion: 100, neuroticism: 100 }) }),
      customConfig
    );

    // (1 + 1*1) * 1 = 2
    expect(profile.positiveEmotionGain).toBeCloseTo(2);
    expect(profile.negativeEmotionGain).toBeCloseTo(2);
    expect(profile.perceptionDampingSigma).toBe(0.99);
  });

  it("引数のcharacterを書き換えない", () => {
    const input = character({ bigFive: bigFive({ extraversion: 50 }) });
    const snapshot = JSON.parse(JSON.stringify(input));

    resolveAffectProfile(input);

    expect(input).toEqual(snapshot);
  });
});
