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
  /** 100 × (1 − (1 − e/100) × (1 − i/100))。仕様と同じ式をテスト側でも計算する */
  function noisyOr(e: number, i: number): number {
    return 100 * (1 - (1 - e / 100) * (1 - i / 100));
  }

  it("1件だけの加算 → e=0 のときはそのまま強さになる", () => {
    const input = emotions({ joy: 0 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 20, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBeCloseTo(20);
  });

  it("すでに強さがある情動への1件の加算 → 確率的な和になる（足し算にはならない）", () => {
    const input = emotions({ joy: 10 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 20, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBeCloseTo(noisyOr(10, 20));
    expect(result.joy).toBeLessThan(30); // 足し算（30）にはならない
  });

  it("同じ情動への複数の加算 → 確率的な和で合わさる（例: e=0 に55が2回 → 79.75）", () => {
    const input = emotions({ joy: 0 });
    const impulses: EmotionImpulse[] = [
      { emotion: "joy", intensity: 55, cause: "player", summary: "a" },
      { emotion: "joy", intensity: 55, cause: "self", summary: "b" },
    ];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBeCloseTo(79.75);
  });

  it("例: e=50 に強さ50の加算 → 75", () => {
    const input = emotions({ joy: 50 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 50, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBeCloseTo(75);
  });

  it("複数の加算は順番によらず同じ結果になる", () => {
    const input = emotions({ joy: 10 });
    const impulsesA: EmotionImpulse[] = [
      { emotion: "joy", intensity: 30, cause: "player", summary: "a" },
      { emotion: "joy", intensity: 45, cause: "self", summary: "b" },
      { emotion: "joy", intensity: 15, cause: "other", summary: "c" },
    ];
    const impulsesB = [...impulsesA].reverse();

    const resultA = applyEmotionImpulses(input, impulsesA);
    const resultB = applyEmotionImpulses(input, impulsesB);

    expect(resultA.joy).toBeCloseTo(resultB.joy);
  });

  it("強さ100を超える加算が複数あっても100を超えない", () => {
    const input = emotions({ joy: 0 });
    const impulses: EmotionImpulse[] = [
      { emotion: "joy", intensity: 200, cause: "player", summary: "a" },
      { emotion: "joy", intensity: 150, cause: "self", summary: "b" },
    ];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBe(100);
  });

  it("100を超える加算 → iを100扱いにした結果に収める", () => {
    const input = emotions({ joy: 50 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 150, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBe(100); // i=100扱いなので e に関わらず100になる
  });

  it("0の加算 → 値が変わらない", () => {
    const input = emotions({ joy: 42 });
    const impulses: EmotionImpulse[] = [{ emotion: "joy", intensity: 0, cause: "player", summary: "" }];

    const result = applyEmotionImpulses(input, impulses);

    expect(result.joy).toBeCloseTo(42);
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
