import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/dynamo.js", () => ({
  getStoredAffectState: vi.fn(),
  getRelationshipRecord: vi.fn(),
}));

import { loadProjectedAffectState } from "../../../src/lib/affectStateStore.js";
import { getRelationshipRecord, getStoredAffectState } from "../../../src/lib/dynamo.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS } from "../../../src/types.js";
import type {
  CharacterAffectState,
  CharacterDefinition,
  Emotions,
  Lifestyle,
  Perception,
  RelationshipRecord,
  RelationshipStage,
  World,
} from "../../../src/types.js";

const mockedGetStoredAffectState = vi.mocked(getStoredAffectState);
const mockedGetRelationshipRecord = vi.mocked(getRelationshipRecord);

const TZ = "Asia/Tokyo";

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

const STAGES: RelationshipStage[] = [
  stage({ key: "first" }),
  stage({ key: "second", label: "顔なじみ", description: "顔なじみの関係" }),
];

function world(): World {
  return {
    key: "test-world",
    name: "テスト世界",
    description: "テスト用の世界観",
    rules: [],
    forbiddenElements: [],
    timezone: TZ,
  };
}

function lifestyle(): Lifestyle {
  return {
    key: "test-lifestyle",
    schedules: {
      weekday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: 0 }],
      holiday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: 0 }],
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

function affectState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: emotions(),
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 30, loneliness: 0 },
    perception: perception(),
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function relationshipRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    firstMetAt: "2026-08-01T00:00:00.000Z",
    lastConversationAt: "2026-08-01T00:00:00.000Z",
    lastConversationDate: "2026-08-01",
    conversationCount: 1,
    conversationDays: 1,
    stageKey: "second",
    highestStageKey: "second",
    recoveryRemaining: 0,
    lastDemotedAt: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetStoredAffectState.mockResolvedValue({ state: null, legacyPerception: null });
  mockedGetRelationshipRecord.mockResolvedValue(null);
});

describe("状態レコードが無い場合", () => {
  it("初期状態から始め、isNewStateがtrueになる", async () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const ch = character();

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: ch,
      lifestyle: lifestyle(),
      now,
    });

    expect(result.isNewState).toBe(true);
    expect(result.state.perception).toEqual(ch.initialPerception);
    expect(result.state.needs.fatigue).toBe(DEFAULT_AFFECT_CONFIG.needs.fatigueBaseline);
  });
});

describe("古い形式のレコード（legacyPerception）", () => {
  it("関係値だけ引き継ぎ、isNewStateはtrueになる", async () => {
    const legacyPerception = perception({ trust: 88, affection: 77 });
    mockedGetStoredAffectState.mockResolvedValue({ state: null, legacyPerception });
    const now = new Date("2026-09-10T00:00:00.000Z");

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now,
    });

    expect(result.isNewState).toBe(true);
    expect(result.state.perception.trust).toBe(88);
    expect(result.state.perception.affection).toBe(77);
  });
});

describe("stageKeyを渡す場合", () => {
  it("関係の記録（getRelationshipRecord）を読まない", async () => {
    await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now: new Date("2026-09-10T00:00:00.000Z"),
      stageKey: "second",
    });

    expect(mockedGetRelationshipRecord).not.toHaveBeenCalled();
  });

  it("渡したstageKeyの段階が使われる", async () => {
    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now: new Date("2026-09-10T00:00:00.000Z"),
      stageKey: "second",
    });

    expect(result.stage.key).toBe("second");
    expect(result.stageIndex).toBe(1);
  });
});

describe("stageKeyを渡さない場合", () => {
  it("関係の記録の段階を使う", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord({ stageKey: "second" }));

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(mockedGetRelationshipRecord).toHaveBeenCalledWith("char-1");
    expect(result.stage.key).toBe("second");
    expect(result.stageIndex).toBe(1);
  });

  it("関係の記録が無ければ最初の段階を使う", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(null);

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(result.stage.key).toBe("first");
    expect(result.stageIndex).toBe(0);
  });
});

describe("時間の経過", () => {
  it("nowまで時間が進んでいる（affectUpdatedAtがnowになる）", async () => {
    const stored = affectState({ affectUpdatedAt: "2026-09-01T00:00:00.000Z" });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });
    const now = new Date("2026-09-10T00:00:00.000Z");

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now,
    });

    expect(result.state.affectUpdatedAt).toBe(now.toISOString());
    expect(result.isNewState).toBe(false);
  });

  it("情動が経過時間ぶん減衰している", async () => {
    const stored = affectState({
      emotions: emotions({ joy: 80 }),
      affectUpdatedAt: "2026-09-01T00:00:00.000Z",
    });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });
    const now = new Date("2026-09-10T00:00:00.000Z");

    const result = await loadProjectedAffectState({
      characterId: "char-1",
      world: world(),
      character: character(),
      lifestyle: lifestyle(),
      now,
    });

    expect(result.state.emotions.joy).toBeLessThan(80);
  });
});
