import { describe, it, expect } from "vitest";
import { computeFatigue, projectLoneliness, relieveLonelinessByMessage } from "../../../../src/lib/affect/needs.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectConfig, AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import type { Lifestyle } from "../../../../src/types.js";

const TZ = "Asia/Tokyo";

// 2026-09-17は木曜、9/18は金曜、9/19は土曜、9/20は日曜、9/22は火曜（actionSlots.test.ts と同じ基準日）。

function lifestyle(overrides: Partial<Lifestyle["schedules"]> = {}): Lifestyle {
  return {
    key: "test-lifestyle",
    schedules: {
      weekday: [],
      holiday: [],
      ...overrides,
    },
    eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
  };
}

function configWithNeeds(overrides: Partial<AffectConfig["needs"]> = {}): AffectConfig {
  return {
    ...DEFAULT_AFFECT_CONFIG,
    needs: { ...DEFAULT_AFFECT_CONFIG.needs, ...overrides },
  };
}

describe("computeFatigue", () => {
  it("枠の率 × 時間ぶん積み上がること", () => {
    // 火曜19:00 JST を基準に6時間さかのぼる。終日「仕事」(rate 5)の枠に収まる。
    const now = new Date("2026-09-22T10:00:00.000Z"); // JST 19:00 火曜
    const life = lifestyle({
      weekday: [{ start: "00:00", end: "00:00", activity: "仕事", fatigueChangePerHour: 5 }],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 6, fatigueBaseline: 0 });

    expect(computeFatigue(life, TZ, now, config)).toBe(30); // 0 + 5*6
  });

  it("負のfatigueChangePerHourの枠で回復すること", () => {
    // 火曜10:00〜16:00 JST。10:00〜13:00「残業」(+10)、13:00〜16:00「休憩」(-4)
    const now = new Date("2026-09-22T07:00:00.000Z"); // JST 16:00 火曜
    const life = lifestyle({
      weekday: [
        { start: "10:00", end: "13:00", activity: "残業", fatigueChangePerHour: 10 },
        { start: "13:00", end: "16:00", activity: "休憩", fatigueChangePerHour: -4 },
      ],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 6, fatigueBaseline: 0 });

    // 0 + 10*3 = 30 → 30 + (-4)*3 = 18
    expect(computeFatigue(life, TZ, now, config)).toBe(18);
  });

  it("枠ごとに0〜100へ収めるため、途中で上限に張り付いたあとの回復量が最終値に正しく反映されること", () => {
    // 火曜08:00〜14:00 JST。08:00〜10:00「残業」(+20)、10:00〜14:00「休憩」(-5)
    const now = new Date("2026-09-22T05:00:00.000Z"); // JST 14:00 火曜
    const life = lifestyle({
      weekday: [
        { start: "08:00", end: "10:00", activity: "残業", fatigueChangePerHour: 20 },
        { start: "10:00", end: "14:00", activity: "休憩", fatigueChangePerHour: -5 },
      ],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 6, fatigueBaseline: 90 });

    // 90 + 20*2 = 130 → 枠ごとに収めるので100に張り付く → 100 + (-5)*4 = 80
    // （最後にまとめて収めるだけなら 90+40-20=110 → 100 になり、80 にはならない）
    expect(computeFatigue(life, TZ, now, config)).toBe(80);
  });

  it("fatigueChangePerHourを省略した枠は0として扱われること", () => {
    // 火曜09:00〜12:00 JST の「読書」に fatigueChangePerHour を指定しない
    const now = new Date("2026-09-22T03:00:00.000Z"); // JST 12:00 火曜
    const life = lifestyle({
      weekday: [{ start: "09:00", end: "12:00", activity: "読書" }],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 3, fatigueBaseline: 40 });

    expect(computeFatigue(life, TZ, now, config)).toBe(40); // 変わらない
  });

  it("fatigueLookbackHoursを長くすると、さかのぼって積み上げる時間が伸びること", () => {
    const now = new Date("2026-09-22T10:00:00.000Z"); // JST 19:00 火曜
    const life = lifestyle({
      weekday: [{ start: "00:00", end: "00:00", activity: "仕事", fatigueChangePerHour: 5 }],
    });

    const short = computeFatigue(life, TZ, now, configWithNeeds({ fatigueLookbackHours: 3, fatigueBaseline: 0 }));
    const long = computeFatigue(life, TZ, now, configWithNeeds({ fatigueLookbackHours: 6, fatigueBaseline: 0 }));

    expect(short).toBe(15); // 5*3
    expect(long).toBe(30); // 5*6
  });

  it("fatigueBaselineを変えると、積み上げの開始点が変わること", () => {
    const now = new Date("2026-09-22T10:00:00.000Z"); // JST 19:00 火曜
    const life = lifestyle({
      weekday: [{ start: "00:00", end: "00:00", activity: "仕事", fatigueChangePerHour: 5 }],
    });

    const fromZero = computeFatigue(life, TZ, now, configWithNeeds({ fatigueLookbackHours: 4, fatigueBaseline: 0 }));
    const fromTwenty = computeFatigue(
      life,
      TZ,
      now,
      configWithNeeds({ fatigueLookbackHours: 4, fatigueBaseline: 20 })
    );

    expect(fromZero).toBe(20); // 0 + 5*4
    expect(fromTwenty).toBe(40); // 20 + 5*4
  });

  it("平日と休日で同じactivity名でも、その枠の暦日に応じた生活様式のfatigueChangePerHourを使うこと", () => {
    // 土曜（休日）10:00〜14:00 JST。同名「日常」が平日(rate10)・休日(rate2)の両方にある
    const now = new Date("2026-09-19T05:00:00.000Z"); // JST 14:00 土曜
    const life = lifestyle({
      weekday: [{ start: "00:00", end: "00:00", activity: "日常", fatigueChangePerHour: 10 }],
      holiday: [{ start: "00:00", end: "00:00", activity: "日常", fatigueChangePerHour: 2 }],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 4, fatigueBaseline: 0 });

    expect(computeFatigue(life, TZ, now, config)).toBe(8); // 2*4（誤って平日を使うと40になる）
  });

  it("日をまたぐ枠でも、実際の時間の長さぶんだけ積み上がること", () => {
    // 木曜22:00 JST 〜 金曜02:00 JST（4時間）の「夜ふかし」
    const now = new Date("2026-09-17T17:00:00.000Z"); // JST 02:00 金曜
    const life = lifestyle({
      weekday: [{ start: "22:00", end: "02:00", activity: "夜ふかし", fatigueChangePerHour: 4 }],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 4, fatigueBaseline: 0 });

    expect(computeFatigue(life, TZ, now, config)).toBe(16); // 4*4
  });

  it("activityの文字列で率を引き、同じ文字列が複数あれば先頭の値を使うこと", () => {
    // 08:00〜09:00と09:00〜10:00の両方が activity: "朝食"。率は先頭(1)を使うため、
    // 2つ目の枠自身に書かれた99ではなく1が使われる
    const now = new Date("2026-09-22T01:00:00.000Z"); // JST 10:00 火曜
    const life = lifestyle({
      weekday: [
        { start: "08:00", end: "09:00", activity: "朝食", fatigueChangePerHour: 1 },
        { start: "09:00", end: "10:00", activity: "朝食", fatigueChangePerHour: 99 },
      ],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 2, fatigueBaseline: 0 });

    expect(computeFatigue(life, TZ, now, config)).toBe(2); // 1*1 + 1*1（99なら100になるはず）
  });

  it("平日から日をまたぐ枠が期間の開始で休日側に切り詰められ、休日に同じactivityが無い → 平日の率が使われること", () => {
    // 金曜23:00〜翌07:00「就寝」(-10)。期間は土曜03:00〜07:00 JST（枠の開始が土曜に切り詰められる）。
    // 休日の生活様式には「就寝」が無い。
    const now = new Date("2026-09-18T22:00:00.000Z"); // JST 土曜 07:00
    const life = lifestyle({
      weekday: [{ start: "23:00", end: "07:00", activity: "就寝", fatigueChangePerHour: -10 }],
      holiday: [{ start: "09:00", end: "12:00", activity: "外出", fatigueChangePerHour: 1 }],
    });
    const config = configWithNeeds({ fatigueLookbackHours: 4, fatigueBaseline: 80 });

    expect(computeFatigue(life, TZ, now, config)).toBe(40); // 80 + (-10)*4
  });
});

function profile(overrides: Partial<AffectProfile> = {}): AffectProfile {
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

// 孤独感のテストで使う共通の設定値。数値をきれいにするため既定値とは変えている。
const LONELINESS_CONFIG = configWithNeeds({
  lonelinessGrowthPerDay: 10,
  lonelinessMaxFromAbsence: 90,
  lonelinessReliefPerMessage: 8,
  lonelinessFirstStageFactor: 0.2,
  lonelinessDependenceFactor: { min: 0.5, max: 1.5 },
  lonelinessAttachmentFactor: { secure: 1, anxious: 2, avoidant: 0.5 },
});

describe("projectLoneliness", () => {
  it("経過がsessionGapMinutes未満 → 値が変わらないこと", () => {
    const result = projectLoneliness(
      40,
      12 / 60, // 12分（sessionGapMinutes=30未満）
      { dependence: 100, stageIndex: 0, stageCount: 1, profile: profile() },
      LONELINESS_CONFIG
    );

    expect(result).toBe(40);
  });

  describe("段階の係数", () => {
    // dependence=1(係数0.5)・secure(係数1)・growthScale=1 に固定し、増える量 = 10*1日*係数*0.5 = 5*係数
    it("最初の段階（stageIndex=0） → lonelinessFirstStageFactorが使われること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 3, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(1); // 5 * 0.2
    });

    it("最後の段階（stageIndex=stageCount-1） → 係数1が使われること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 2, stageCount: 3, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(5); // 5 * 1
    });

    it("間の段階 → 直線で補間されること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 1, stageCount: 3, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(3); // 5 * (0.2 + (1-0.2)*0.5) = 5*0.6
    });

    it("段階が1つ（stageCount=1） → 係数1が使われること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(5); // 5 * 1
    });
  });

  describe("dependenceの係数", () => {
    // stageCount=1(係数1)・secure(係数1)・growthScale=1 に固定し、増える量 = 10*1日*dependence係数
    it("dependence=1 → lonelinessDependenceFactor.minが使われること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(5); // 10 * 0.5
    });

    it("dependence=100 → lonelinessDependenceFactor.maxが使われること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 100, stageIndex: 0, stageCount: 1, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(15); // 10 * 1.5
    });

    it("dependenceが中間（50.5） → min〜maxの中間の係数になること", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 50.5, stageIndex: 0, stageCount: 1, profile: profile() },
        LONELINESS_CONFIG
      );

      expect(result).toBeCloseTo(10); // 10 * 1.0（0.5と1.5の中間）
    });
  });

  describe("愛着のスタイル", () => {
    // stageCount=1(係数1)・dependence=1(係数0.5)・growthScale=1 に固定し、増える量 = 5 * 愛着の係数
    it("secure → 係数1", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile({ attachmentStyle: "secure" }) },
        LONELINESS_CONFIG
      );
      expect(result).toBeCloseTo(5);
    });

    it("anxious → 係数2（secureより増えやすい）", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile({ attachmentStyle: "anxious" }) },
        LONELINESS_CONFIG
      );
      expect(result).toBeCloseTo(10);
    });

    it("avoidant → 係数0.5（secureより増えにくい）", () => {
      const result = projectLoneliness(
        0,
        24,
        { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile({ attachmentStyle: "avoidant" }) },
        LONELINESS_CONFIG
      );
      expect(result).toBeCloseTo(2.5);
    });
  });

  it("profile.lonelinessGrowthScaleが増える量にかかること", () => {
    const result = projectLoneliness(
      0,
      24,
      { dependence: 1, stageIndex: 0, stageCount: 1, profile: profile({ lonelinessGrowthScale: 3 }) },
      LONELINESS_CONFIG
    );

    expect(result).toBeCloseTo(15); // 5 * 3
  });

  it("増える量がlonelinessMaxFromAbsenceを超える場合は上限で収まること", () => {
    const result = projectLoneliness(
      0,
      240, // 10日
      { dependence: 100, stageIndex: 0, stageCount: 1, profile: profile({ attachmentStyle: "anxious" }) },
      LONELINESS_CONFIG
    );

    // 10 * 10日 * 1 * 1.5 * 2 = 300 → 上限90に収まる
    expect(result).toBe(90);
  });

  it("もとの値がすでに上限を超えている場合は、もとの値のままであること", () => {
    const result = projectLoneliness(
      95, // lonelinessMaxFromAbsence(90)を超えている
      24,
      { dependence: 100, stageIndex: 0, stageCount: 1, profile: profile({ attachmentStyle: "anxious" }) },
      LONELINESS_CONFIG
    );

    expect(result).toBe(95);
  });
});

describe("relieveLonelinessByMessage", () => {
  it("lonelinessReliefPerMessageぶん減ること", () => {
    const result = relieveLonelinessByMessage(50, LONELINESS_CONFIG);
    expect(result).toBe(42); // 50 - 8
  });

  it("下限0を下回らないこと", () => {
    const result = relieveLonelinessByMessage(5, LONELINESS_CONFIG);
    expect(result).toBe(0); // 5 - 8 は負なので0
  });
});
