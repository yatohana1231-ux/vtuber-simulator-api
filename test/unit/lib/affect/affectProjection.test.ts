import { describe, it, expect } from "vitest";
import {
  createInitialAffectState,
  resolveStoredAffectState,
  projectAffectState,
} from "../../../../src/lib/affect/affectProjection.js";
import { decayEmotions } from "../../../../src/lib/affect/emotionDynamics.js";
import { computeEffectiveHomeBase, decayMoodTowardHomeBase } from "../../../../src/lib/affect/moodDynamics.js";
import { computeFatigue, projectLoneliness } from "../../../../src/lib/affect/needs.js";
import { applyPerceptionDelta, decayFamiliarity, resolveStageBase } from "../../../../src/lib/affect/perceptionDynamics.js";
import { settleSession } from "../../../../src/lib/affect/sessionAccumulator.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectConfig, AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS } from "../../../../src/types.js";
import type {
  CharacterAffectState,
  CharacterDefinition,
  Emotions,
  Lifestyle,
  PendingSession,
  Perception,
  RelationshipStage,
} from "../../../../src/types.js";

const TZ = "Asia/Tokyo";

// ---- テスト用のヘルパー ----

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

function emotions(overrides: Partial<Emotions> = {}): Emotions {
  const base = Object.fromEntries(EMOTION_KEYS.map((key) => [key, 0])) as Emotions;
  return { ...base, ...overrides };
}

function stage(overrides: Partial<RelationshipStage> = {}): RelationshipStage {
  return {
    key: "first",
    label: "はじめまして",
    description: "顔見知り",
    speechStyle: "丁寧語",
    speechExamples: [],
    promoteWhen: null,
    ...overrides,
  };
}

const STAGES: RelationshipStage[] = [stage({ key: "first" }), stage({ key: "second", label: "顔なじみ" })];

function profile(overrides: Partial<AffectProfile> = {}): AffectProfile {
  return {
    moodHomeBase: { pleasure: 5, arousal: -5, dominance: 0 },
    positiveEmotionGain: 1,
    negativeEmotionGain: 1,
    emotionHalfLifeScale: 1,
    moodHalfLifeScale: 1,
    lonelinessGrowthScale: 1,
    perceptionGainScale: 1,
    perceptionDampingSigma: DEFAULT_AFFECT_CONFIG.perception.dampingSigma,
    goals: [],
    attachmentStyle: "secure",
    ...overrides,
  };
}

function lifestyle(rate = 5): Lifestyle {
  return {
    key: "test-lifestyle",
    schedules: {
      // 平日・休日とも終日同じ活動にして、テストの基準日の曜日に依存しないようにする
      weekday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: rate }],
      holiday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: rate }],
    },
    eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
  };
}

function character(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    key: "test-character",
    name: "テストキャラ",
    personality: "テスト用の性格",
    speechStyle: "普通",
    relationship: "テスト用の関係",
    background: "テスト用の背景",
    speechExamples: [],
    initialPerception: perception({ trust: 20, affection: 20, respect: 20, fear: 5, dependence: 5, familiarity: 20 }),
    relationshipStages: STAGES,
    ...overrides,
  };
}

function pendingSession(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    startedAt: "2026-09-22T00:00:00.000Z",
    lastMessageAt: "2026-09-22T00:00:00.000Z",
    messageCount: 1,
    peak: {},
    last: {},
    ...overrides,
  };
}

function affectState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: emotions(),
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 30, loneliness: 0 },
    perception: perception(),
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

// ---- createInitialAffectState ----

describe("createInitialAffectState", () => {
  const now = new Date("2026-09-22T03:00:00.000Z");

  it("情動はすべて0であること", () => {
    const result = createInitialAffectState(character(), profile(), now);
    for (const key of EMOTION_KEYS) {
      expect(result.emotions[key]).toBe(0);
    }
  });

  it("気分はprofile.moodHomeBaseであること", () => {
    const p = profile({ moodHomeBase: { pleasure: 12, arousal: -3, dominance: 7 } });
    const result = createInitialAffectState(character(), p, now);
    expect(result.mood).toEqual({ pleasure: 12, arousal: -3, dominance: 7 });
  });

  it("欲求はfatigue=fatigueBaseline・loneliness=0であること", () => {
    const config: AffectConfig = { ...DEFAULT_AFFECT_CONFIG, needs: { ...DEFAULT_AFFECT_CONFIG.needs, fatigueBaseline: 42 } };
    const result = createInitialAffectState(character(), profile(), now, config);
    expect(result.needs).toEqual({ fatigue: 42, loneliness: 0 });
  });

  it("関係値はcharacter.initialPerceptionのコピーであること", () => {
    const c = character({ initialPerception: perception({ trust: 33 }) });
    const result = createInitialAffectState(c, profile(), now);

    expect(result.perception).toEqual(c.initialPerception);
    expect(result.perception).not.toBe(c.initialPerception);
  });

  it("perceptionStageBase・pendingSessionはnullであること", () => {
    const result = createInitialAffectState(character(), profile(), now);
    expect(result.perceptionStageBase).toBeNull();
    expect(result.pendingSession).toBeNull();
  });

  it("affectUpdatedAtはnowのISO文字列であること", () => {
    const result = createInitialAffectState(character(), profile(), now);
    expect(result.affectUpdatedAt).toBe(now.toISOString());
  });
});

// ---- resolveStoredAffectState ----

describe("resolveStoredAffectState", () => {
  const now = new Date("2026-09-22T03:00:00.000Z");

  it("stateがあれば、legacyPerceptionがあってもstateをそのまま返す", () => {
    const stored = affectState({ perception: perception({ trust: 77 }) });
    const result = resolveStoredAffectState(
      { state: stored, legacyPerception: perception({ trust: 1 }) },
      character(),
      profile(),
      now
    );

    expect(result).toBe(stored);
  });

  it("stateが無く、legacyPerceptionも無ければ初期状態を返す", () => {
    const c = character({ initialPerception: perception({ trust: 15 }) });
    const result = resolveStoredAffectState({ state: null, legacyPerception: null }, c, profile(), now);

    expect(result.perception).toEqual(c.initialPerception);
    expect(result.affectUpdatedAt).toBe(now.toISOString());
    for (const key of EMOTION_KEYS) {
      expect(result.emotions[key]).toBe(0);
    }
  });

  it("stateが無く、legacyPerceptionがあれば関係値だけをそれに置き換える（感情は平常値から）", () => {
    const legacy = perception({ trust: 88, affection: 66, respect: 44, fear: 3, dependence: 2, familiarity: 90 });
    const p = profile({ moodHomeBase: { pleasure: 8, arousal: 2, dominance: -1 } });
    const result = resolveStoredAffectState({ state: null, legacyPerception: legacy }, character(), p, now);

    expect(result.perception).toEqual(legacy);
    expect(result.mood).toEqual(p.moodHomeBase);
    for (const key of EMOTION_KEYS) {
      expect(result.emotions[key]).toBe(0);
    }
  });
});

// ---- projectAffectState ----

describe("projectAffectState", () => {
  it("nowがaffectUpdatedAtより前 → 経過時間0として、時間による変化が起きないこと", () => {
    const state = affectState({
      emotions: emotions({ joy: 50 }),
      mood: { pleasure: 20, arousal: 20, dominance: 20 },
      needs: { fatigue: 40, loneliness: 30 },
      perception: perception({ familiarity: 60 }),
      affectUpdatedAt: "2026-09-22T10:00:00.000Z",
    });
    const past = new Date("2026-09-22T09:00:00.000Z"); // affectUpdatedAtより1時間前

    const result = projectAffectState(state, past, {
      profile: profile(),
      lifestyle: lifestyle(0), // 疲労は生活様式から再計算されるので0固定にして影響を切り離す
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    expect(result.emotions.joy).toBe(50); // 減衰しない
    expect(result.mood).toEqual(state.mood); // 平常値へ寄らない
    expect(result.needs.loneliness).toBe(30); // 増えない
    expect(result.perception.familiarity).toBe(60); // 減衰しない
  });

  describe("セッションの確定", () => {
    it("終わっていれば関係値に反映され、pendingSessionがnullになること（上限・釣り鐘が効いた値であること）", () => {
      const baseStageValues = perception({ trust: 0 });
      const currentPerception = perception({ trust: 90 });
      const state = affectState({
        perception: currentPerception,
        perceptionStageBase: { stageKey: "first", values: baseStageValues },
        pendingSession: pendingSession({
          lastMessageAt: "2026-09-22T00:00:00.000Z",
          peak: { trust: 30 },
          last: { trust: 10 },
        }),
        affectUpdatedAt: "2026-09-22T00:00:00.000Z",
      });
      const now = new Date("2026-09-22T00:31:00.000Z"); // 31分後（sessionGapMinutes=30以上）

      const p = profile();
      const result = projectAffectState(state, now, {
        profile: p,
        lifestyle: lifestyle(0),
        timeZone: TZ,
        stages: [STAGES[0]],
        stageKey: "first",
      });

      expect(result.pendingSession).toBeNull();

      // 期待値: settleSession → applyPerceptionDelta（上限100・下端0での釣り鐘の減衰つき）
      const delta = settleSession(state.pendingSession as PendingSession);
      const expectedPerception = applyPerceptionDelta(
        { perception: currentPerception, delta, stage: STAGES[0], stageBase: baseStageValues, profile: p },
        DEFAULT_AFFECT_CONFIG
      );

      expect(result.perception.trust).toBeCloseTo(expectedPerception.trust, 6);
      // 減衰が効いていること（peak・lastの単純平均である20をそのまま足した110にはならない）
      expect(result.perception.trust).toBeLessThan(currentPerception.trust + 20);
      expect(result.perception.trust).toBeGreaterThan(currentPerception.trust);
    });

    it("終わっていなければpendingSessionが残り、関係値は変わらないこと", () => {
      const originalPerception = perception({ trust: 50, familiarity: 60 });
      const originalPending = pendingSession({
        lastMessageAt: "2026-09-22T00:00:00.000Z",
        peak: { trust: 30 },
        last: { trust: 10 },
      });
      const state = affectState({
        perception: originalPerception,
        pendingSession: originalPending,
        affectUpdatedAt: "2026-09-22T00:00:00.000Z",
      });
      const now = new Date("2026-09-22T00:10:00.000Z"); // 10分後（sessionGapMinutes=30未満）

      const result = projectAffectState(state, now, {
        profile: profile(),
        lifestyle: lifestyle(0),
        timeZone: TZ,
        stages: [STAGES[0]],
        stageKey: "first",
      });

      expect(result.pendingSession).toEqual(originalPending);
      expect(result.perception).toEqual(originalPerception);
    });
  });

  it("情動が経過時間ぶん減衰すること", () => {
    const state = affectState({
      emotions: emotions({ joy: 80, anger: 40 }),
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const p = profile();
    const now = new Date("2026-09-22T06:00:00.000Z"); // 6時間後

    const result = projectAffectState(state, now, {
      profile: p,
      lifestyle: lifestyle(0),
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    const expected = decayEmotions(state.emotions, 6, p, DEFAULT_AFFECT_CONFIG);
    expect(result.emotions).toEqual(expected);
    expect(result.emotions.joy).toBeLessThan(80);
  });

  it("気分が（欲求でずらした）平常値へ寄ること", () => {
    const p = profile({ moodHomeBase: { pleasure: 10, arousal: -10, dominance: 0 } });
    const state = affectState({
      mood: { pleasure: -50, arousal: 50, dominance: -50 },
      needs: { fatigue: 30, loneliness: 20 },
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const now = new Date("2026-09-22T12:00:00.000Z"); // 12時間後

    const result = projectAffectState(state, now, {
      profile: p,
      lifestyle: lifestyle(0), // fatigueは0固定
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    // ④は③のあとのneedsを使う（fatigueはlifestyle(0)でも既定のfatigueBaselineから決まる。loneliness も③で更新された値）
    const expectedFatigue = computeFatigue(lifestyle(0), TZ, now, DEFAULT_AFFECT_CONFIG);
    const expectedNeeds = { fatigue: expectedFatigue, loneliness: result.needs.loneliness };
    const homeBase = computeEffectiveHomeBase(p, expectedNeeds, DEFAULT_AFFECT_CONFIG);
    const expectedMood = decayMoodTowardHomeBase(state.mood, homeBase, 12, p, DEFAULT_AFFECT_CONFIG);

    expect(result.mood.pleasure).toBeCloseTo(expectedMood.pleasure, 6);
    expect(result.mood.arousal).toBeCloseTo(expectedMood.arousal, 6);
    expect(result.mood.dominance).toBeCloseTo(expectedMood.dominance, 6);
    // 平常値に近づいている（もとの-50より0/10に近い）
    expect(result.mood.pleasure).toBeGreaterThan(-50);
  });

  it("孤独感が会っていない時間ぶん増えること", () => {
    const state = affectState({
      needs: { fatigue: 30, loneliness: 10 },
      perception: perception({ dependence: 50 }),
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const p = profile();
    const now = new Date("2026-09-23T00:00:00.000Z"); // 24時間後

    const result = projectAffectState(state, now, {
      profile: p,
      lifestyle: lifestyle(0),
      timeZone: TZ,
      stages: STAGES,
      stageKey: "first",
    });

    const expected = projectLoneliness(
      10,
      24,
      { dependence: 50, stageIndex: 0, stageCount: 2, profile: p },
      DEFAULT_AFFECT_CONFIG
    );
    expect(result.needs.loneliness).toBeCloseTo(expected, 6);
    expect(result.needs.loneliness).toBeGreaterThan(10);
  });

  it("疲労が生活様式だけから決まること（保存されていた値は使わない）", () => {
    const state = affectState({
      needs: { fatigue: 5, loneliness: 0 }, // 保存されていた値（無視されるはず）
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const life = lifestyle(8);
    const now = new Date("2026-09-22T05:00:00.000Z");

    const result = projectAffectState(state, now, {
      profile: profile(),
      lifestyle: life,
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    const expected = computeFatigue(life, TZ, now, DEFAULT_AFFECT_CONFIG);
    expect(result.needs.fatigue).toBe(expected);
    expect(result.needs.fatigue).not.toBe(5);
  });

  it("familiarityが経過日数ぶん減衰すること", () => {
    const state = affectState({
      perception: perception({ familiarity: 80 }),
      affectUpdatedAt: "2026-09-01T00:00:00.000Z",
    });
    const now = new Date("2026-10-11T00:00:00.000Z"); // 40日後（既定のfamiliarityDecayAfterDays=30を超える）

    const result = projectAffectState(state, now, {
      profile: profile(),
      lifestyle: lifestyle(0),
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    const expected = decayFamiliarity(80, 40, DEFAULT_AFFECT_CONFIG);
    expect(result.perception.familiarity).toBeCloseTo(expected, 6);
    expect(result.perception.familiarity).toBeLessThan(80);
  });

  describe("perceptionStageBase", () => {
    it("今の段階と同じであれば、そのまま保たれること", () => {
      const base = { stageKey: "first", values: perception({ trust: 12 }) };
      const state = affectState({ perceptionStageBase: base, affectUpdatedAt: "2026-09-22T00:00:00.000Z" });
      const now = new Date("2026-09-22T00:05:00.000Z");

      const result = projectAffectState(state, now, {
        profile: profile(),
        lifestyle: lifestyle(0),
        timeZone: TZ,
        stages: STAGES,
        stageKey: "first",
      });

      expect(result.perceptionStageBase).toEqual(base);
    });

    it("段階が変わっていれば、新しい段階のキーと今の関係値で作り直されること", () => {
      const base = { stageKey: "first", values: perception({ trust: 12 }) };
      const currentPerception = perception({ trust: 77, familiarity: 33 });
      const state = affectState({
        perception: currentPerception,
        perceptionStageBase: base,
        affectUpdatedAt: "2026-09-22T00:00:00.000Z",
      });
      const now = new Date("2026-09-22T00:05:00.000Z"); // 短い経過なのでfamiliarityは減衰しない

      const result = projectAffectState(state, now, {
        profile: profile(),
        lifestyle: lifestyle(0),
        timeZone: TZ,
        stages: STAGES,
        stageKey: "second",
      });

      expect(result.perceptionStageBase?.stageKey).toBe("second");
      expect(result.perceptionStageBase?.values).toEqual(result.perception);
      expect(result.perceptionStageBase?.values).not.toEqual(base.values);
    });
  });

  it("affectUpdatedAtがnowのISO文字列に更新されること", () => {
    const state = affectState({ affectUpdatedAt: "2026-09-22T00:00:00.000Z" });
    const now = new Date("2026-09-25T09:30:00.000Z");

    const result = projectAffectState(state, now, {
      profile: profile(),
      lifestyle: lifestyle(0),
      timeZone: TZ,
      stages: [STAGES[0]],
      stageKey: "first",
    });

    expect(result.affectUpdatedAt).toBe(now.toISOString());
  });

  it("stagesに無いstageKeyを渡すと、先頭の段階として扱われること", () => {
    const state = affectState({
      needs: { fatigue: 30, loneliness: 10 },
      perception: perception({ dependence: 50 }),
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const p = profile();
    const now = new Date("2026-09-23T00:00:00.000Z"); // 24時間後

    const result = projectAffectState(state, now, {
      profile: p,
      lifestyle: lifestyle(0),
      timeZone: TZ,
      stages: STAGES, // ["first", "second"]
      stageKey: "unknown-stage-key",
    });

    // stageIndex=0（先頭="first"）として孤独感の段階の係数が計算されているはず
    const expected = projectLoneliness(
      10,
      24,
      { dependence: 50, stageIndex: 0, stageCount: 2, profile: p },
      DEFAULT_AFFECT_CONFIG
    );
    expect(result.needs.loneliness).toBeCloseTo(expected, 6);
    expect(result.perceptionStageBase?.stageKey).toBe(STAGES[0].key);
  });

  it("引数（state・ctx.profile・ctx.lifestyle）を書き換えないこと", () => {
    const state = affectState({
      emotions: emotions({ joy: 50 }),
      perception: perception({ trust: 60, familiarity: 70 }),
      pendingSession: pendingSession({ lastMessageAt: "2026-09-22T00:00:00.000Z", peak: { trust: 10 }, last: { trust: 5 } }),
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const p = profile();
    const profileSnapshot = JSON.parse(JSON.stringify(p));
    const life = lifestyle(5);
    const lifestyleSnapshot = JSON.parse(JSON.stringify(life));
    const now = new Date("2026-09-22T01:00:00.000Z"); // sessionを終わらせる

    projectAffectState(state, now, {
      profile: p,
      lifestyle: life,
      timeZone: TZ,
      stages: STAGES,
      stageKey: "first",
    });

    expect(state).toEqual(stateSnapshot);
    expect(p).toEqual(profileSnapshot);
    expect(life).toEqual(lifestyleSnapshot);
  });

  it("同じ入力を何度渡しても同じ結果になること（保存せずに読むだけを繰り返しても結果が変わらない）", () => {
    const state = affectState({
      emotions: emotions({ joy: 50, anxiety: 20 }),
      mood: { pleasure: -10, arousal: 15, dominance: 5 },
      needs: { fatigue: 30, loneliness: 10 },
      perception: perception({ trust: 60, familiarity: 40 }),
      pendingSession: pendingSession({ lastMessageAt: "2026-09-22T00:00:00.000Z", peak: { trust: 10 }, last: { trust: 5 } }),
      affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    });
    const p = profile();
    const life = lifestyle(5);
    const now = new Date("2026-09-22T02:00:00.000Z");
    const ctx = { profile: p, lifestyle: life, timeZone: TZ, stages: STAGES, stageKey: "first" };

    const result1 = projectAffectState(state, now, ctx);
    const result2 = projectAffectState(state, now, ctx);

    expect(result1).toEqual(result2);
  });
});
