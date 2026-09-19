import { describe, it, expect } from "vitest";
import { simulatePerceptionGrowth } from "../../../../src/lib/affect/perceptionGrowthSimulation.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectConfig } from "../../../../src/lib/affect/affectConfig.js";
import { loadPackage } from "../../../../src/lib/packages.js";
import type { CharacterDefinition, Perception, PerceptionContribution, RelationshipStage } from "../../../../src/types.js";

// ---- テスト用のヘルパー ----

function perception(overrides: Partial<Perception> = {}): Perception {
  return {
    trust: 30,
    affection: 30,
    respect: 30,
    fear: 10,
    dependence: 10,
    familiarity: 30,
    ...overrides,
  };
}

function stage(overrides: Partial<RelationshipStage> = {}): RelationshipStage {
  return {
    key: "first",
    label: "はじめまして",
    description: "テスト用の段階",
    speechStyle: "テスト用の話し方",
    speechExamples: [],
    promoteWhen: null,
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
    relationshipStages: [stage()],
    ...overrides,
  };
}

describe("simulatePerceptionGrowth", () => {
  it("最初の段階は0日目に入る", () => {
    const char = character({
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          promoteWhen: { minConversationDays: 1000, minConversationCount: 1000, minPerception: {} },
        }),
      ],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: { familiarity: 1 },
      maxDays: 5,
    });

    expect(results[0].enteredOnDay).toBe(0);
  });

  it("履歴の条件のほうが遅い場合 → 履歴の条件を満たした日に上がる", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          // familiarity はすぐ届くが、会話した日数の条件（5日）が遅い
          promoteWhen: { minConversationDays: 5, minConversationCount: 1, minPerception: { familiarity: 35 } },
        }),
      ],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: { familiarity: 10 },
      maxDays: 30,
    });

    expect(results[0].perceptionConditionMetOnDay).toBe(1);
    expect(results[0].historyConditionMetOnDay).toBe(5);
    expect(results[0].promotedOnDay).toBe(5);
  });

  it("関係値の条件のほうが遅い場合 → 関係値の条件を満たした日に上がる", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          // 会話した日数・回数の条件はすぐ満たすが、familiarity の上限（100）に近づくほど
          // 釣り鐘の減衰で伸びが鈍るため、関係値の条件（80）に届くまで時間がかかる
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: { familiarity: 80 } },
        }),
      ],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: { familiarity: 1 },
      maxDays: 365,
    });

    expect(results[0].historyConditionMetOnDay).toBe(1);
    expect(results[0].perceptionConditionMetOnDay).not.toBeNull();
    expect(results[0].perceptionConditionMetOnDay).toBeGreaterThan(1);
    expect(results[0].promotedOnDay).toBe(results[0].perceptionConditionMetOnDay);
  });

  it("差分が0なら上がらず、promotedOnDayがnullのまま", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: { familiarity: 31 } },
        }),
      ],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: {}, // 寄与なし
      maxDays: 20,
    });

    expect(results).toHaveLength(1); // 次の段階には進まない
    expect(results[0].promotedOnDay).toBeNull();
    expect(results[0].perceptionAtEnd.familiarity).toBe(30); // 動かない
  });

  it("maxDaysで打ち切る → maxDaysまでに条件を満たさなければ、その段階で終わる", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: { familiarity: 60 } },
        }),
      ],
    });
    const sessionDelta: PerceptionContribution = { familiarity: 1 };

    const cutShort = simulatePerceptionGrowth({ character: char, sessionDelta, maxDays: 5 });
    expect(cutShort).toHaveLength(1);
    expect(cutShort[0].promotedOnDay).toBeNull();

    // 十分な日数を与えれば、同じキャラクター・差分でも次の段階に進める
    const withMoreDays = simulatePerceptionGrowth({ character: char, sessionDelta, maxDays: 365 });
    expect(withMoreDays.length).toBeGreaterThan(1);
    expect(withMoreDays[0].promotedOnDay).not.toBeNull();
  });

  it("sessionsPerDayを増やすと早く上がる", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: { familiarity: 50 } },
        }),
      ],
    });
    const sessionDelta: PerceptionContribution = { familiarity: 1 };

    const oneSessionPerDay = simulatePerceptionGrowth({ character: char, sessionDelta, sessionsPerDay: 1, maxDays: 365 });
    const threeSessionsPerDay = simulatePerceptionGrowth({
      character: char,
      sessionDelta,
      sessionsPerDay: 3,
      maxDays: 365,
    });

    expect(oneSessionPerDay[0].promotedOnDay).not.toBeNull();
    expect(threeSessionsPerDay[0].promotedOnDay).not.toBeNull();
    expect(threeSessionsPerDay[0].promotedOnDay!).toBeLessThan(oneSessionPerDay[0].promotedOnDay!);
  });

  it("gainScaleを下げると上がるのが遅くなる", () => {
    const char = character({
      initialPerception: perception({ familiarity: 30 }),
      relationshipStages: [
        stage({ key: "first", promoteWhen: null }),
        stage({
          key: "second",
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: { familiarity: 50 } },
        }),
      ],
    });
    const sessionDelta: PerceptionContribution = { familiarity: 1 };

    const defaultGain = simulatePerceptionGrowth({ character: char, sessionDelta, maxDays: 365 }, DEFAULT_AFFECT_CONFIG);
    const lowerGainConfig: AffectConfig = {
      ...DEFAULT_AFFECT_CONFIG,
      perception: { ...DEFAULT_AFFECT_CONFIG.perception, gainScale: DEFAULT_AFFECT_CONFIG.perception.gainScale * 0.3 },
    };
    const lowerGain = simulatePerceptionGrowth({ character: char, sessionDelta, maxDays: 365 }, lowerGainConfig);

    expect(defaultGain[0].promotedOnDay).not.toBeNull();
    expect(lowerGain[0].promotedOnDay).not.toBeNull();
    expect(lowerGain[0].promotedOnDay!).toBeGreaterThan(defaultGain[0].promotedOnDay!);
  });

  it("段階の上限を超えない", () => {
    const char = character({
      initialPerception: perception({ trust: 30 }),
      relationshipStages: [stage({ key: "first", promoteWhen: null, maxPerception: { trust: 50 } })],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: { trust: 100 }, // 極端に大きい差分
      sessionsPerDay: 5,
      maxDays: 100,
    });

    expect(results[0].perceptionAtEnd.trust).toBeLessThanOrEqual(50);
  });

  it("最後の段階（次の段階が無い）のpromotedOnDayはnull", () => {
    const char = character({
      relationshipStages: [stage({ key: "only", promoteWhen: null })],
    });

    const results = simulatePerceptionGrowth({
      character: char,
      sessionDelta: { familiarity: 5 },
      maxDays: 30,
    });

    expect(results).toHaveLength(1);
    expect(results[0].promotedOnDay).toBeNull();
  });

  // 設定値（affectConfig.ts の perception.gainScale・dampingSigma、yui.json の各段階の
  // maxPerception・promoteWhen）を変えたときに、ペースが意図（「特別な存在まで約3か月」）から
  // 外れたことに気づくための回帰テスト。範囲から外れたら、直近で変えた設定値を見直すこと。
  it("本物のゆい・既定の設定値 → 最後の段階に上がる日が75〜100日の範囲に入る", async () => {
    const pkg = await loadPackage("yui-modern-tokyo");
    expect(pkg).not.toBeNull();

    const sessionDelta: PerceptionContribution = {
      trust: 1.0,
      affection: 1.4,
      respect: 0.5,
      dependence: 0.4,
      familiarity: 2.2,
    };

    const results = simulatePerceptionGrowth({
      character: pkg!.character,
      sessionDelta,
      maxDays: 365,
    });

    const lastStage = results[results.length - 1];
    expect(lastStage.stageKey).toBe("special");
    expect(lastStage.enteredOnDay).toBeGreaterThanOrEqual(75);
    expect(lastStage.enteredOnDay).toBeLessThanOrEqual(100);
  });
});
