import { describe, it, expect } from "vitest";
import {
  createNeutralEmotions,
  decayEmotions,
  applyEmotionImpulses,
  getActiveEmotions,
} from "../../../../src/lib/affect/emotionDynamics.js";
import { DEFAULT_AFFECT_CONFIG, type AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS, type Emotions, type EmotionImpulse } from "../../../../src/types.js";

function affectProfile(overrides: Partial<AffectProfile> = {}): AffectProfile {
  return {
    moodHomeBase: { pleasure: 0, arousal: 0, dominance: 0 },
    positiveEmotionGain: 1,
    negativeEmotionGain: 1,
    emotionHalfLifeScale: 1,
    moodHalfLifeScale: 1,
    lonelinessGrowthScale: 1,
    perceptionGainScale: 1,
    perceptionDampingSigma: 0.45,
    goals: [],
    attachmentStyle: "secure",
    ...overrides,
  };
}

function emotions(overrides: Partial<Emotions> = {}): Emotions {
  return { ...createNeutralEmotions(), ...overrides };
}

describe("createNeutralEmotions", () => {
  it("EMOTION_KEYSのすべての情動が0になる", () => {
    const result = createNeutralEmotions();
    for (const key of EMOTION_KEYS) {
      expect(result[key]).toBe(0);
    }
    expect(Object.keys(result).sort()).toEqual([...EMOTION_KEYS].sort());
  });
});

describe("decayEmotions", () => {
  it("半減期ちょうど経過 → 値が半分になる", () => {
    const profile = affectProfile();
    const input = emotions({ joy: 100 });
    const halfLife = DEFAULT_AFFECT_CONFIG.emotion.halfLifeHours.joy;

    const result = decayEmotions(input, halfLife, profile);

    expect(result.joy).toBeCloseTo(50, 5);
    expect(result.sadness).toBe(0);
  });

  it("emotionHalfLifeScaleが効く → 半減期がスケールぶん伸びる", () => {
    const profile = affectProfile({ emotionHalfLifeScale: 2 });
    const input = emotions({ joy: 100 });
    const halfLife = DEFAULT_AFFECT_CONFIG.emotion.halfLifeHours.joy * 2;

    const result = decayEmotions(input, halfLife, profile);

    expect(result.joy).toBeCloseTo(50, 5);
  });

  it("経過時間が0 → 値を変えない", () => {
    const profile = affectProfile();
    const input = emotions({ joy: 80, sadness: 40 });

    expect(decayEmotions(input, 0, profile)).toEqual(input);
  });

  it("経過時間が負 → 値を変えない", () => {
    const profile = affectProfile();
    const input = emotions({ joy: 80, sadness: 40 });

    expect(decayEmotions(input, -5, profile)).toEqual(input);
  });

  it("減衰した結果が0.01未満 → 0にする", () => {
    const profile = affectProfile();
    const input = emotions({ joy: 1 });

    const result = decayEmotions(input, 1000, profile);

    expect(result.joy).toBe(0);
  });

  it("引数のemotionsを書き換えない", () => {
    const profile = affectProfile();
    const input = emotions({ joy: 80 });
    const snapshot = { ...input };

    decayEmotions(input, 4, profile);

    expect(input).toEqual(snapshot);
  });
});

describe("applyEmotionImpulses", () => {
  it("加算 → 値が増える", () => {
    const input = emotions({ joy: 10 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 20, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBe(30);
  });

  it("100を超える加算 → 100に収める", () => {
    const input = emotions({ joy: 90 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 30, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBe(100);
  });

  it("同じ情動への複数の加算 → すべて反映される", () => {
    const input = emotions({ joy: 0 });
    const impulses: EmotionImpulse[] = [
      { emotion: "joy", intensity: 10, cause: "player", summary: "a" },
      { emotion: "joy", intensity: 15, cause: "self", summary: "b" },
    ];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBe(25);
  });

  it("引数のemotions/impulsesを書き換えない", () => {
    const input = emotions({ joy: 10 });
    const snapshot = { ...input };
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 5, cause: "player", summary: "" }];
    const impulsesSnapshot = [...impulses];

    applyEmotionImpulses(input, impulses);

    expect(input).toEqual(snapshot);
    expect(impulses).toEqual(impulsesSnapshot);
  });
});

describe("getActiveEmotions", () => {
  it("activeThresholdちょうどの値 → 活動中に含まれる", () => {
    const input = emotions({ joy: DEFAULT_AFFECT_CONFIG.emotion.activeThreshold });

    const result = getActiveEmotions(input);

    expect(result).toEqual([{ emotion: "joy", intensity: DEFAULT_AFFECT_CONFIG.emotion.activeThreshold }]);
  });

  it("activeThresholdを下回る → 含まれない", () => {
    const input = emotions({ joy: DEFAULT_AFFECT_CONFIG.emotion.activeThreshold - 0.001 });

    const result = getActiveEmotions(input);

    expect(result).toEqual([]);
  });

  it("複数の活動中の情動 → 強い順に並ぶ", () => {
    const input = emotions({ joy: 20, sadness: 50, hope: 35 });

    const result = getActiveEmotions(input);

    expect(result).toEqual([
      { emotion: "sadness", intensity: 50 },
      { emotion: "hope", intensity: 35 },
      { emotion: "joy", intensity: 20 },
    ]);
  });
});
