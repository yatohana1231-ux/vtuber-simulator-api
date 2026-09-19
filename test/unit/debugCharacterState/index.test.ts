import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/affectStateStore.js", () => ({
  loadProjectedAffectState: vi.fn(),
}));
vi.mock("../../../src/lib/dynamo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/dynamo.js")>();
  return {
    ...actual,
    saveCharacterAffectState: vi.fn(),
  };
});

import { runDebugCharacterState } from "../../../src/debugCharacterState/index.js";
import { loadProjectedAffectState } from "../../../src/lib/affectStateStore.js";
import { saveCharacterAffectState } from "../../../src/lib/dynamo.js";
import { EMOTION_KEYS } from "../../../src/types.js";
import type { AffectProfile } from "../../../src/lib/affect/affectConfig.js";
import type { ProjectedAffectState } from "../../../src/lib/affectStateStore.js";
import type {
  CharacterAffectState,
  CharacterDefinition,
  DebugCharacterStateRequest,
  Emotions,
  Lifestyle,
  Perception,
  RelationshipStage,
  World,
} from "../../../src/types.js";

const mockedLoad = vi.mocked(loadProjectedAffectState);
const mockedSave = vi.mocked(saveCharacterAffectState);

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

function world(): World {
  return {
    key: "test-world",
    name: "テスト世界",
    description: "テスト用の世界観",
    rules: [],
    forbiddenElements: [],
    timezone: "Asia/Tokyo",
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
    initialPerception: perception(),
    relationshipStages: [stage()],
    ...overrides,
  };
}

function affectState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: emotions(),
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 30, loneliness: 20 },
    perception: perception(),
    perceptionStageBase: { stageKey: "first", values: perception() },
    pendingSession: null,
    affectUpdatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function projected(overrides: Partial<ProjectedAffectState> = {}): ProjectedAffectState {
  return {
    state: affectState(),
    profile: {} as unknown as AffectProfile,
    stage: stage(),
    stageIndex: 0,
    isNewState: false,
    ...overrides,
  };
}

function baseReq(overrides: Partial<DebugCharacterStateRequest> = {}): DebugCharacterStateRequest {
  return {
    characterId: "char-1",
    world: world(),
    character: character(),
    lifestyle: lifestyle(),
    now: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockedLoad.mockResolvedValue(projected());
});

describe("emotions/mood/needs/perceptionがすべて未指定のとき", () => {
  it("saveCharacterAffectStateを呼ばない", async () => {
    await runDebugCharacterState(baseReq());

    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("nowまで進めた値（loadProjectedAffectStateの結果）をそのまま返す", async () => {
    const state = affectState({ emotions: emotions({ joy: 40 }) });
    mockedLoad.mockResolvedValue(projected({ state, stage: stage({ key: "second", label: "顔なじみ" }) }));

    const result = await runDebugCharacterState(baseReq());

    expect(result).toEqual({
      emotions: state.emotions,
      mood: state.mood,
      needs: state.needs,
      perception: state.perception,
      pendingSession: state.pendingSession,
      stage: { key: "second", label: "顔なじみ", maxPerception: {} },
      affectUpdatedAt: state.affectUpdatedAt,
    });
  });

  it("loadProjectedAffectStateにcharacterId/world/character/lifestyle/nowが渡る", async () => {
    const req = baseReq();

    await runDebugCharacterState(req);

    expect(mockedLoad).toHaveBeenCalledWith({
      characterId: "char-1",
      world: req.world,
      character: req.character,
      lifestyle: req.lifestyle,
      now: new Date(req.now),
    });
  });
});

describe("emotionsのみ指定したとき", () => {
  it("emotionsだけが置き換わり、ほかの見出しはnowまで進めた値のまま保存される", async () => {
    const state = affectState();
    mockedLoad.mockResolvedValue(projected({ state }));
    const newEmotions = emotions({ joy: 90, sadness: 5 });

    const result = await runDebugCharacterState(baseReq({ emotions: newEmotions }));

    expect(mockedSave).toHaveBeenCalledWith("char-1", {
      ...state,
      emotions: newEmotions,
    });
    expect(result.emotions).toEqual(newEmotions);
    expect(result.mood).toEqual(state.mood);
    expect(result.needs).toEqual(state.needs);
    expect(result.perception).toEqual(state.perception);
  });
});

describe("moodのみ指定したとき", () => {
  it("moodだけが置き換わって保存される", async () => {
    const state = affectState();
    mockedLoad.mockResolvedValue(projected({ state }));
    const newMood = { pleasure: 60, arousal: -20, dominance: 10 };

    const result = await runDebugCharacterState(baseReq({ mood: newMood }));

    expect(mockedSave).toHaveBeenCalledWith("char-1", {
      ...state,
      mood: newMood,
    });
    expect(result.mood).toEqual(newMood);
    expect(result.emotions).toEqual(state.emotions);
  });
});

describe("needsのみ指定したとき", () => {
  it("lonelinessだけが置き換わり、fatigueはnowまで進めた値のまま保存される", async () => {
    const state = affectState({ needs: { fatigue: 45, loneliness: 10 } });
    mockedLoad.mockResolvedValue(projected({ state }));

    const result = await runDebugCharacterState(baseReq({ needs: { loneliness: 77 } }));

    expect(mockedSave).toHaveBeenCalledWith("char-1", {
      ...state,
      needs: { fatigue: 45, loneliness: 77 },
    });
    expect(result.needs).toEqual({ fatigue: 45, loneliness: 77 });
  });
});

describe("perceptionのみ指定したとき", () => {
  it("perceptionが置き換わり、perceptionStageBaseがnullになって保存される", async () => {
    const state = affectState({
      perceptionStageBase: { stageKey: "first", values: perception() },
    });
    mockedLoad.mockResolvedValue(projected({ state }));
    const newPerception = perception({ trust: 95 });

    const result = await runDebugCharacterState(baseReq({ perception: newPerception }));

    expect(mockedSave).toHaveBeenCalledWith("char-1", {
      ...state,
      perception: newPerception,
      perceptionStageBase: null,
    });
    expect(result.perception).toEqual(newPerception);
  });

  it("段階の上限を超えるperceptionの値も、削らずそのまま保存される", async () => {
    const capped = stage({ maxPerception: { trust: 40 } });
    mockedLoad.mockResolvedValue(projected({ stage: capped }));
    const newPerception = perception({ trust: 99 });

    const result = await runDebugCharacterState(baseReq({ perception: newPerception }));

    expect(mockedSave).toHaveBeenCalledWith(
      "char-1",
      expect.objectContaining({ perception: newPerception })
    );
    expect(result.perception.trust).toBe(99);
  });
});

describe("複数の見出しを同時に指定したとき", () => {
  it("指定した見出しだけがそれぞれ置き換わって保存される", async () => {
    const state = affectState();
    mockedLoad.mockResolvedValue(projected({ state }));
    const newEmotions = emotions({ pride: 30 });
    const newPerception = perception({ affection: 80 });

    const result = await runDebugCharacterState(
      baseReq({ emotions: newEmotions, perception: newPerception })
    );

    expect(mockedSave).toHaveBeenCalledWith("char-1", {
      ...state,
      emotions: newEmotions,
      perception: newPerception,
      perceptionStageBase: null,
    });
    expect(result.emotions).toEqual(newEmotions);
    expect(result.mood).toEqual(state.mood);
    expect(result.perception).toEqual(newPerception);
  });
});

describe("stageのレスポンス", () => {
  it("loadProjectedAffectStateが返した段階のkey・label・maxPerceptionを返す", async () => {
    mockedLoad.mockResolvedValue(
      projected({ stage: stage({ key: "second", label: "顔なじみ", maxPerception: { trust: 40, affection: 50 } }) })
    );

    const result = await runDebugCharacterState(baseReq());

    expect(result.stage).toEqual({ key: "second", label: "顔なじみ", maxPerception: { trust: 40, affection: 50 } });
  });

  it("段階にmaxPerceptionが無ければ空オブジェクトを返す", async () => {
    mockedLoad.mockResolvedValue(projected({ stage: stage({ key: "first" }) }));

    const result = await runDebugCharacterState(baseReq());

    expect(result.stage.maxPerception).toEqual({});
  });
});

describe("状態レコードが無いとき（loadProjectedAffectStateが初期状態を返す）", () => {
  it("その初期状態をそのまま読み取りのみで返す", async () => {
    const initial = affectState({
      emotions: emotions(),
      needs: { fatigue: 25, loneliness: 0 },
      perception: character().initialPerception,
      perceptionStageBase: null,
    });
    mockedLoad.mockResolvedValue(projected({ state: initial, isNewState: true }));

    const result = await runDebugCharacterState(baseReq());

    expect(mockedSave).not.toHaveBeenCalled();
    expect(result.perception).toEqual(initial.perception);
    expect(result.needs).toEqual(initial.needs);
  });
});
