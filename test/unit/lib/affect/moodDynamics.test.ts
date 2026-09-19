import { describe, it, expect } from "vitest";
import {
  computeEffectiveHomeBase,
  decayMoodTowardHomeBase,
  applyPullPush,
  describeMood,
} from "../../../../src/lib/affect/moodDynamics.js";
import { DEFAULT_AFFECT_CONFIG, type AffectConfig, type AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS, type EmotionKey, type Emotions, type MoodPad, type Needs } from "../../../../src/types.js";

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

function mood(overrides: Partial<MoodPad> = {}): MoodPad {
  return { pleasure: 0, arousal: 0, dominance: 0, ...overrides };
}

function needs(overrides: Partial<Needs> = {}): Needs {
  return { fatigue: 0, loneliness: 0, ...overrides };
}

function emotions(overrides: Partial<Emotions> = {}): Emotions {
  const base = Object.fromEntries(EMOTION_KEYS.map((key) => [key, 0])) as Emotions;
  return { ...base, ...overrides };
}

/** pad（情動ごとのPAD座標）だけを差し替えたAffectConfig。押し引きの中心をテストしやすい位置に固定する */
function configWithPad(pad: Partial<Record<EmotionKey, MoodPad>>): AffectConfig {
  return {
    ...DEFAULT_AFFECT_CONFIG,
    emotion: {
      ...DEFAULT_AFFECT_CONFIG.emotion,
      pad: { ...DEFAULT_AFFECT_CONFIG.emotion.pad, ...pad },
    },
  };
}

describe("computeEffectiveHomeBase", () => {
  it("疲労がたまっている → 平常値の覚醒が下がる", () => {
    const profile = affectProfile({ moodHomeBase: mood({ pleasure: 10, arousal: 5, dominance: 0 }) });

    const result = computeEffectiveHomeBase(profile, needs({ fatigue: 100, loneliness: 0 }));

    expect(result.arousal).toBeCloseTo(5 + DEFAULT_AFFECT_CONFIG.mood.arousalOffsetAtFullFatigue, 5);
    expect(result.pleasure).toBe(10);
    expect(result.dominance).toBe(0);
  });

  it("孤独感がたまっている → 平常値の快が下がる", () => {
    const profile = affectProfile({ moodHomeBase: mood({ pleasure: 10, arousal: 5, dominance: 0 }) });

    const result = computeEffectiveHomeBase(profile, needs({ fatigue: 0, loneliness: 100 }));

    expect(result.pleasure).toBeCloseTo(10 + DEFAULT_AFFECT_CONFIG.mood.pleasureOffsetAtFullLoneliness, 5);
    expect(result.arousal).toBe(5);
  });

  it("ずれが範囲を超える → -100〜+100に収める", () => {
    const profile = affectProfile({ moodHomeBase: mood({ pleasure: 0, arousal: -90, dominance: 0 }) });

    const result = computeEffectiveHomeBase(profile, needs({ fatigue: 100, loneliness: 0 }));

    expect(result.arousal).toBe(-100);
  });

  it("引数のprofile/needsを書き換えない", () => {
    const profile = affectProfile({ moodHomeBase: mood({ pleasure: 10 }) });
    const need = needs({ fatigue: 50, loneliness: 50 });
    const profileSnapshot = { ...profile, moodHomeBase: { ...profile.moodHomeBase } };
    const needSnapshot = { ...need };

    computeEffectiveHomeBase(profile, need);

    expect(profile).toEqual(profileSnapshot);
    expect(need).toEqual(needSnapshot);
  });
});

describe("decayMoodTowardHomeBase", () => {
  it("半減期ちょうど経過 → 平常値との差が半分になる", () => {
    const profile = affectProfile();
    const home = mood({ pleasure: 0, arousal: 0, dominance: 0 });
    const current = mood({ pleasure: 100, arousal: -80, dominance: 40 });

    const result = decayMoodTowardHomeBase(current, home, DEFAULT_AFFECT_CONFIG.mood.halfLifeHours, profile);

    expect(result.pleasure).toBeCloseTo(50, 5);
    expect(result.arousal).toBeCloseTo(-40, 5);
    expect(result.dominance).toBeCloseTo(20, 5);
  });

  it("moodHalfLifeScaleが効く → 半減期がスケールぶん伸びる", () => {
    const profile = affectProfile({ moodHalfLifeScale: 2 });
    const home = mood();
    const current = mood({ pleasure: 100 });
    const halfLife = DEFAULT_AFFECT_CONFIG.mood.halfLifeHours * 2;

    const result = decayMoodTowardHomeBase(current, home, halfLife, profile);

    expect(result.pleasure).toBeCloseTo(50, 5);
  });

  it("引数のmood/homeBaseを書き換えない", () => {
    const profile = affectProfile();
    const home = mood({ pleasure: 0 });
    const current = mood({ pleasure: 80 });
    const currentSnapshot = { ...current };
    const homeSnapshot = { ...home };

    decayMoodTowardHomeBase(current, home, 10, profile);

    expect(current).toEqual(currentSnapshot);
    expect(home).toEqual(homeSnapshot);
  });
});

describe("applyPullPush", () => {
  it("活動中の情動が無い → 気分は変わらない", () => {
    const current = mood({ pleasure: 10, arousal: -5, dominance: 3 });

    const result = applyPullPush(current, emotions());

    expect(result).toEqual(current);
  });

  it("中心（活動中の情動のPAD座標の重み付き平均）が原点付近 → 気分は変わらない", () => {
    const config = configWithPad({
      joy: { pleasure: 50, arousal: 0, dominance: 0 },
      sadness: { pleasure: -50, arousal: 0, dominance: 0 },
    });
    const em = emotions({ joy: 50, sadness: 50 });
    const current = mood({ pleasure: 3, arousal: -2, dominance: 1 });

    const result = applyPullPush(current, em, config);

    expect(result).toEqual(current);
  });

  it("pull: 中心の手前 → 中心の向きに幅のぶん近づく", () => {
    const config = configWithPad({ joy: { pleasure: 60, arousal: 0, dominance: 0 } });
    const em = emotions({ joy: 100 });

    const result = applyPullPush(mood(), em, config);

    // center=(60,0,0)、centerStrength=100、幅=pullPushStepAtFullIntensity(20)*100/100=20
    expect(result.pleasure).toBeCloseTo(20, 5);
    expect(result.arousal).toBe(0);
    expect(result.dominance).toBe(0);
  });

  it("pull: 幅のぶん動くと中心を通り越す位置 → 中心で止まる（通り越さない）", () => {
    const config = configWithPad({ joy: { pleasure: 60, arousal: 0, dominance: 0 } });
    const em = emotions({ joy: 100 });

    const result = applyPullPush(mood({ pleasure: 50 }), em, config);

    // 中心までの残り距離10 < 幅20 なので、中心の60でとどまる（50+20=70にはならない）
    expect(result.pleasure).toBeCloseTo(60, 5);
  });

  it("pull: 中心の向きに直交する成分がある → その成分も中心の点に向かって寄る", () => {
    const config = configWithPad({ joy: { pleasure: 60, arousal: 0, dominance: 0 } });
    const em = emotions({ joy: 100 });

    // center=(60,0,0)、気分=(0,-80,0)。中心までの距離は100、幅は20 → 中心に向かって 1/5 だけ動く
    const result = applyPullPush(mood({ arousal: -80 }), em, config);

    expect(result.pleasure).toBeCloseTo(12, 5); // 0 + 60 * 0.2
    expect(result.arousal).toBeCloseTo(-64, 5); // -80 + 80 * 0.2
    expect(result.dominance).toBe(0);
  });

  it("push: 中心より外側にいる → さらに外へ押し出される", () => {
    const config = configWithPad({ joy: { pleasure: 50, arousal: 0, dominance: 0 } });
    const em = emotions({ joy: 100 });

    const result = applyPullPush(mood({ pleasure: 70 }), em, config);

    // 中心50よりすでに外側（70）。幅20ぶんさらに外へ
    expect(result.pleasure).toBeCloseTo(90, 5);
  });

  it("複数の情動 → PAD座標の強さによる重み付き平均が中心になる", () => {
    const config = configWithPad({
      joy: { pleasure: 100, arousal: 0, dominance: 0 },
      hope: { pleasure: 0, arousal: 100, dominance: 0 },
    });
    const em = emotions({ joy: 75, hope: 25 });

    const result = applyPullPush(mood(), em, config);

    // center = (75*100+25*0, 75*0+25*100, 0) / 100 = (75, 25, 0)
    // centerStrength = (75+25)/2 = 50、幅 = 20*50/100 = 10
    const distance = Math.sqrt(75 ** 2 + 25 ** 2);
    expect(result.pleasure).toBeCloseTo((75 / distance) * 10, 2);
    expect(result.arousal).toBeCloseTo((25 / distance) * 10, 2);
    expect(result.dominance).toBeCloseTo(0, 5);
  });

  it("引数のmood/emotionsを書き換えない", () => {
    const current = mood({ pleasure: 10 });
    const currentSnapshot = { ...current };
    const em = emotions({ joy: 50 });
    const emSnapshot = { ...em };

    applyPullPush(current, em);

    expect(current).toEqual(currentSnapshot);
    expect(em).toEqual(emSnapshot);
  });
});

describe("describeMood", () => {
  it("原点からの距離がneutralRadius未満 → neutral", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.neutralRadius - 0.001 }));

    expect(result).toEqual({ octant: "neutral", strength: "slight" });
  });

  it("原点からの距離がneutralRadiusちょうど → neutralではない", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.neutralRadius }));

    expect(result.octant).not.toBe("neutral");
  });

  it("+快+覚醒+支配 → exuberant", () => {
    const result = describeMood(mood({ pleasure: 80, arousal: 80, dominance: 80 }));
    expect(result.octant).toBe("exuberant");
  });

  it("-快-覚醒-支配 → bored", () => {
    const result = describeMood(mood({ pleasure: -80, arousal: -80, dominance: -80 }));
    expect(result.octant).toBe("bored");
  });

  it("+快+覚醒-支配 → dependent", () => {
    const result = describeMood(mood({ pleasure: 80, arousal: 80, dominance: -80 }));
    expect(result.octant).toBe("dependent");
  });

  it("-快-覚醒+支配 → disdainful", () => {
    const result = describeMood(mood({ pleasure: -80, arousal: -80, dominance: 80 }));
    expect(result.octant).toBe("disdainful");
  });

  it("+快-覚醒+支配 → relaxed", () => {
    const result = describeMood(mood({ pleasure: 80, arousal: -80, dominance: 80 }));
    expect(result.octant).toBe("relaxed");
  });

  it("-快+覚醒-支配 → anxious", () => {
    const result = describeMood(mood({ pleasure: -80, arousal: 80, dominance: -80 }));
    expect(result.octant).toBe("anxious");
  });

  it("+快-覚醒-支配 → docile", () => {
    const result = describeMood(mood({ pleasure: 80, arousal: -80, dominance: -80 }));
    expect(result.octant).toBe("docile");
  });

  it("-快+覚醒+支配 → hostile", () => {
    const result = describeMood(mood({ pleasure: -80, arousal: 80, dominance: 80 }));
    expect(result.octant).toBe("hostile");
  });

  it("0を+とみなす → 該当軸が0でも正の側として象限を決める", () => {
    const result = describeMood(mood({ pleasure: 0, arousal: 60, dominance: 60 }));
    expect(result.octant).toBe("exuberant");
  });

  it("距離がstrengthThresholds.moderate未満 → slight", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.strengthThresholds.moderate - 0.001 }));
    expect(result.strength).toBe("slight");
  });

  it("距離がstrengthThresholds.moderateちょうど → moderate", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.strengthThresholds.moderate }));
    expect(result.strength).toBe("moderate");
  });

  it("距離がstrengthThresholds.strong未満 → moderate", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.strengthThresholds.strong - 0.001 }));
    expect(result.strength).toBe("moderate");
  });

  it("距離がstrengthThresholds.strongちょうど → strong", () => {
    const result = describeMood(mood({ pleasure: DEFAULT_AFFECT_CONFIG.mood.strengthThresholds.strong }));
    expect(result.strength).toBe("strong");
  });

  it("引数のmoodを書き換えない", () => {
    const current = mood({ pleasure: 80, arousal: 80, dominance: 80 });
    const snapshot = { ...current };

    describeMood(current);

    expect(current).toEqual(snapshot);
  });
});
