import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getStoredAffectState: vi.fn(),
  getRelationshipRecord: vi.fn(),
  getLatestAbsenceRecord: vi.fn(),
  getRecentLogs: vi.fn(),
  saveCharacterAffectState: vi.fn(),
}));

import { runEmotionUpdater } from "../../../src/emotionUpdater/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../src/lib/affect/affectConfig.js";
import {
  getLatestAbsenceRecord,
  getRecentLogs,
  getRelationshipRecord,
  getStoredAffectState,
  saveCharacterAffectState,
} from "../../../src/lib/dynamo.js";
import { EMOTION_KEYS } from "../../../src/types.js";
import type {
  AbsenceRecord,
  CharacterAffectState,
  CharacterDefinition,
  ConversationLogItem,
  Emotions,
  EmotionUpdaterRequest,
  Lifestyle,
  Perception,
  RelationshipStage,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetStoredAffectState = vi.mocked(getStoredAffectState);
const mockedGetRelationshipRecord = vi.mocked(getRelationshipRecord);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);
const mockedGetRecentLogs = vi.mocked(getRecentLogs);
const mockedSaveCharacterAffectState = vi.mocked(saveCharacterAffectState);

const NOW = new Date("2026-09-19T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

// ---- フィクスチャ ----

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
    description: "顔見知りの関係",
    speechStyle: "丁寧語",
    speechExamples: [],
    promoteWhen: null,
    ...overrides,
  };
}

const STAGES: RelationshipStage[] = [stage({ key: "first" }), stage({ key: "second", label: "顔なじみ" })];

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "emotionUpdaterテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: "Asia/Tokyo",
};

// 疲労は生活様式だけから毎回計算し直されるため、fatigueChangePerHour=0 で
// 常に fatigueBaseline（30）になるようにし、テストの結果を決めやすくする
const lifestyle: Lifestyle = {
  key: "test-lifestyle",
  schedules: {
    weekday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: 0 }],
    holiday: [{ start: "00:00", end: "00:00", activity: "普段", fatigueChangePerHour: 0 }],
  },
  eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "テスト用の性格",
  speechStyle: "普通",
  relationship: "テスト用の関係",
  background: "テスト用の背景",
  speechExamples: [],
  initialPerception: perception({ trust: 20, affection: 20, respect: 20, fear: 5, dependence: 5, familiarity: 20 }),
  relationshipStages: STAGES,
  goals: [{ key: "goal1", description: "テスト用の目標", importance: 80 }],
};

function storedState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: emotions(),
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 30, loneliness: 20 },
    perception: perception(),
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: NOW_ISO,
    ...overrides,
  };
}

function process1Req(overrides: Partial<EmotionUpdaterRequest> = {}): EmotionUpdaterRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lifestyle,
    now: NOW_ISO,
    process: 1,
    ...overrides,
  } as EmotionUpdaterRequest;
}

function process2Req(overrides: Partial<EmotionUpdaterRequest> = {}): EmotionUpdaterRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lifestyle,
    now: NOW_ISO,
    process: 2,
    playerMessage: "こんにちは",
    ...overrides,
  } as EmotionUpdaterRequest;
}

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-09-19T08:00:00.000Z",
    startDatetime: "2026-09-19T00:00:00.000Z",
    endDatetime: "2026-09-19T08:00:00.000Z",
    events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }],
    actions: [],
    threads: [],
    ...overrides,
  };
}

function log(role: "user" | "assistant", content: string, index: string): ConversationLogItem {
  return { conversation_id: "char-1", index, role, content, memoryRetrieverJudgedFlag: 0 };
}

/** invokeModelJson に渡ったシステムプロンプト（層の配列）を1つの文字列に結合して返す */
function joinedPrompt(callIndex = 0): string {
  const systemPrompt = mockedInvokeModelJson.mock.calls[callIndex][0];
  return Array.isArray(systemPrompt) ? systemPrompt.join("\n") : systemPrompt;
}

/** invokeModelJson に渡ったシステムプロンプトのうち、可変部（層の2番目）だけを返す */
function variableLayer(callIndex = 0): string {
  const systemPrompt = mockedInvokeModelJson.mock.calls[callIndex][0];
  return Array.isArray(systemPrompt) ? systemPrompt[1] : systemPrompt;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetStoredAffectState.mockResolvedValue({ state: storedState(), legacyPerception: null });
  mockedGetRelationshipRecord.mockResolvedValue(null);
  mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord());
  mockedGetRecentLogs.mockResolvedValue([]);
  mockedSaveCharacterAffectState.mockResolvedValue(undefined);
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("process1: 最新の不在期間の記録が無い場合", () => {
  it("LLMを呼ばず、時間を進めた状態を保存して返す", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(null);
    const stored = storedState({ needs: { fatigue: 30, loneliness: 42 } });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });

    const result = await runEmotionUpdater(process1Req());

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedSaveCharacterAffectState).toHaveBeenCalledTimes(1);
    expect(mockedSaveCharacterAffectState).toHaveBeenCalledWith("char-1", expect.objectContaining({ needs: { fatigue: 30, loneliness: 42 } }));
    expect(result).toEqual({
      emotions: stored.emotions,
      mood: stored.mood,
      needs: stored.needs,
      perception: stored.perception,
    });
  });
});

describe("process1の入力文", () => {
  it("記録の出来事のsummary・detailが【評価する入力】に入る", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(
      absenceRecord({ events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }] })
    );

    await runEmotionUpdater(process1Req());

    const prompt = joinedPrompt();
    expect(prompt).toContain("雨が降った");
    expect(prompt).toContain("傘を忘れて濡れた");
  });

  it("characterIdでgetLatestAbsenceRecordが呼ばれる", async () => {
    await runEmotionUpdater(process1Req({ characterId: "char-xyz" }));

    expect(mockedGetLatestAbsenceRecord).toHaveBeenCalledWith("char-xyz");
  });

  it("getRecentLogsを呼ばない", async () => {
    await runEmotionUpdater(process1Req());

    expect(mockedGetRecentLogs).not.toHaveBeenCalled();
  });
});

describe("process2の入力文", () => {
  it("プレイヤーの発言が【評価する入力】に入る", async () => {
    await runEmotionUpdater(process2Req({ playerMessage: "今日は調子どう？" }));

    const prompt = joinedPrompt();
    expect(prompt).toContain("今日は調子どう？");
  });

  it("getLatestAbsenceRecordを呼ばない", async () => {
    await runEmotionUpdater(process2Req());

    expect(mockedGetLatestAbsenceRecord).not.toHaveBeenCalled();
  });
});

describe("process2: 直近の会話から今回の発言以降を除く", () => {
  it("今回の発言より前の会話だけが【最近の会話】に入る", async () => {
    mockedGetRecentLogs.mockResolvedValue([
      log("user", "前の発言1", "2026-09-19T11:00:00.000Z"),
      log("assistant", "前の返事1", "2026-09-19T11:00:05.000Z"),
      log("user", "今日は調子どう？", "2026-09-19T12:00:00.000Z"),
      log("assistant", "元気だよ！", "2026-09-19T12:00:05.000Z"),
    ]);

    await runEmotionUpdater(process2Req({ playerMessage: "今日は調子どう？" }));

    const variable = variableLayer();
    expect(variable).toContain("前の発言1");
    expect(variable).toContain("前の返事1");
    expect(variable).not.toContain("プレイヤー: 今日は調子どう？");
    expect(variable).not.toContain("元気だよ！");
  });

  it("今回の発言と同じcontentのログが見つからなければ全部を入れる", async () => {
    mockedGetRecentLogs.mockResolvedValue([
      log("user", "前の発言1", "2026-09-19T11:00:00.000Z"),
      log("assistant", "前の返事1", "2026-09-19T11:00:05.000Z"),
    ]);

    await runEmotionUpdater(process2Req({ playerMessage: "はじめての発言" }));

    const prompt = joinedPrompt();
    expect(prompt).toContain("前の発言1");
    expect(prompt).toContain("前の返事1");
  });

  it("会話ログが空なら【最近の会話】の節が出ない", async () => {
    mockedGetRecentLogs.mockResolvedValue([]);

    await runEmotionUpdater(process2Req());

    // process=2 向けのルール文自体に「【最近の会話】は流れをつかむための参考…」という
    // 説明が含まれるため、節の見出し（行頭に単独で出る「【最近の会話】」）で判定する
    const variable = variableLayer();
    expect(variable).not.toMatch(/^【最近の会話】$/m);
  });
});

describe("LLMの応答が壊れている・空の場合", () => {
  it("appraisalsが空扱いになり、状態は時間の変化だけで保存される", async () => {
    const stored = storedState({ emotions: emotions({ joy: 10 }), mood: { pleasure: 3, arousal: -2, dominance: 1 } });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });
    mockedInvokeModelJson.mockResolvedValueOnce(null as never);

    const result = await runEmotionUpdater(process1Req());

    expect(result.emotions).toEqual(stored.emotions);
    expect(result.mood).toEqual(stored.mood);
    expect(mockedSaveCharacterAffectState).toHaveBeenCalledWith("char-1", expect.objectContaining({ emotions: stored.emotions }));
  });
});

describe("評価から情動と気分が動く", () => {
  it("desirabilityForSelfが正の評価 → joyが増え、気分も動く", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({
      appraisals: [
        {
          summary: "褒められた",
          desirabilityForSelf: 3,
          desirabilityForPlayer: 0,
          prospect: "happened",
          cause: "self",
          praiseworthiness: 0,
          relatedGoalKey: null,
        },
      ],
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.emotions.joy).toBeGreaterThan(0);
    expect(result.mood).not.toEqual({ pleasure: 0, arousal: 0, dominance: 0 });
  });
});

describe("process2: 孤独感とセッションの途中経過", () => {
  it("孤独感が減る", async () => {
    const stored = storedState({ needs: { fatigue: 30, loneliness: 20 } });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });

    const result = await runEmotionUpdater(process2Req());

    expect(result.needs.loneliness).toBeLessThan(20);
  });

  it("pendingSessionに寄与が入る（発言が1件のセッションが始まる）", async () => {
    const stored = storedState({ pendingSession: null });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });

    await runEmotionUpdater(process2Req());

    const saved = mockedSaveCharacterAffectState.mock.calls[0][1] as CharacterAffectState;
    expect(saved.pendingSession).not.toBeNull();
    expect(saved.pendingSession?.messageCount).toBe(1);
  });

  it("perceptionは発言では変わらない", async () => {
    const stored = storedState({ perception: perception({ trust: 61 }) });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });
    mockedInvokeModelJson.mockResolvedValueOnce({
      appraisals: [
        {
          summary: "ありがとうと言われた",
          desirabilityForSelf: 3,
          desirabilityForPlayer: 0,
          prospect: "happened",
          cause: "player",
          praiseworthiness: 3,
          relatedGoalKey: null,
        },
      ],
    });

    const result = await runEmotionUpdater(process2Req());

    expect(result.perception).toEqual(stored.perception);
  });
});

describe("回帰: 同じ発言から出来事を複数件取り出しても、情動・好感が張り付かない", () => {
  it("cause: player・desirabilityForSelf: 2・praiseworthiness: 2 の評価が2件返っても、joyは100未満、affectionの寄与はaffectionPerPlayerCausedEmotion以下になる", async () => {
    const stored = storedState({ pendingSession: null });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });
    const praiseAppraisal = {
      summary: "配信を見たと言われ、声もほめられた",
      desirabilityForSelf: 2,
      desirabilityForPlayer: 0,
      prospect: "happened",
      cause: "player",
      praiseworthiness: 2,
      relatedGoalKey: null,
    };
    mockedInvokeModelJson.mockResolvedValueOnce({ appraisals: [praiseAppraisal, praiseAppraisal] });

    const result = await runEmotionUpdater(process2Req());

    expect(result.emotions.joy).toBeLessThan(100);

    const saved = mockedSaveCharacterAffectState.mock.calls[0][1] as CharacterAffectState;
    expect(saved.pendingSession?.last.affection).toBeLessThanOrEqual(
      DEFAULT_AFFECT_CONFIG.perception.contribution.affectionPerPlayerCausedEmotion
    );
  });
});

describe("process1では pendingSessionに足さない", () => {
  it("pendingSessionはloadProjectedAffectStateが返した値のまま変わらない", async () => {
    const stored = storedState({ pendingSession: null });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });

    await runEmotionUpdater(process1Req());

    const saved = mockedSaveCharacterAffectState.mock.calls[0][1] as CharacterAffectState;
    expect(saved.pendingSession).toBeNull();
  });
});

describe("セッションが終わっていれば確定してから新しいセッションが始まる", () => {
  it("前の発言から30分以上経っている → 関係値に反映され、新しいセッション（messageCount=1）が始まる", async () => {
    const previousUpdatedAt = "2026-09-19T11:00:00.000Z"; // NOW の1時間前
    const stored = storedState({
      affectUpdatedAt: previousUpdatedAt,
      perception: perception({ trust: 50 }),
      pendingSession: {
        startedAt: "2026-09-19T10:55:00.000Z",
        lastMessageAt: previousUpdatedAt,
        messageCount: 3,
        peak: { trust: 10 },
        last: { trust: 10 },
      },
    });
    mockedGetStoredAffectState.mockResolvedValue({ state: stored, legacyPerception: null });

    const result = await runEmotionUpdater(process2Req());

    const saved = mockedSaveCharacterAffectState.mock.calls[0][1] as CharacterAffectState;
    // 前のセッションの寄与（trust +10）が反映され、関係値が動いている
    expect(result.perception.trust).not.toBe(50);
    // 新しいセッションは今回の発言1件から始まる
    expect(saved.pendingSession?.messageCount).toBe(1);
    expect(saved.pendingSession?.startedAt).toBe(NOW_ISO);
  });
});

describe("警告のログ", () => {
  it("parseEmotionUpdaterModelOutputのwarningsがconsole.warnに出る", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({
      appraisals: [{ summary: "テスト", prospect: "invalid-value", cause: "player" }],
    });

    await runEmotionUpdater(process1Req());

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("prospect"));
  });
});

describe("保存の内容", () => {
  it("characterIdと更新後の状態でsaveCharacterAffectStateが呼ばれる", async () => {
    const result = await runEmotionUpdater(process1Req({ characterId: "char-xyz" }));

    expect(mockedSaveCharacterAffectState).toHaveBeenCalledTimes(1);
    const [savedCharacterId, savedState] = mockedSaveCharacterAffectState.mock.calls[0];
    expect(savedCharacterId).toBe("char-xyz");
    expect(savedState).toEqual(
      expect.objectContaining({
        emotions: result.emotions,
        mood: result.mood,
        needs: result.needs,
        perception: result.perception,
      })
    );
  });
});

describe("レスポンスの形", () => {
  it("{ emotions, mood, needs, perception } を返す", async () => {
    const result = await runEmotionUpdater(process1Req());

    expect(Object.keys(result).sort()).toEqual(["emotions", "mood", "needs", "perception"]);
  });
});
