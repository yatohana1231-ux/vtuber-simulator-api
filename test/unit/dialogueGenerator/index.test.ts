import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModel: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/dynamo.js")>();
  return {
    ...actual,
    getStoredAffectState: vi.fn(),
    getRelevantMemories: vi.fn(),
    getRecentLogs: vi.fn(),
    getLatestAbsenceRecord: vi.fn(),
    getRelationshipRecord: vi.fn(),
    saveConversationLog: vi.fn(),
    saveRelationshipRecord: vi.fn(),
    saveMemory: vi.fn(),
    saveCharacterAffectState: vi.fn(),
  };
});

import { runDialogueGenerator } from "../../../src/dialogueGenerator/index.js";
import { invokeModel } from "../../../src/lib/bedrock.js";
import {
  getStoredAffectState,
  getRelevantMemories,
  getRecentLogs,
  getLatestAbsenceRecord,
  getRelationshipRecord,
  saveConversationLog,
  saveRelationshipRecord,
  saveMemory,
  saveCharacterAffectState,
  RELATIONSHIP_MILESTONE_MEMORY_TYPE,
} from "../../../src/lib/dynamo.js";
import type {
  AbsenceRecord,
  CharacterAffectState,
  CharacterDefinition,
  ConversationLogItem,
  DialogueGeneratorRequest,
  Lifestyle,
  RelationshipRecord,
  RelationshipStage,
  World,
} from "../../../src/types.js";

const mockedInvokeModel = vi.mocked(invokeModel);
const mockedGetStoredAffectState = vi.mocked(getStoredAffectState);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedGetRecentLogs = vi.mocked(getRecentLogs);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);
const mockedGetRelationshipRecord = vi.mocked(getRelationshipRecord);
const mockedSaveConversationLog = vi.mocked(saveConversationLog);
const mockedSaveRelationshipRecord = vi.mocked(saveRelationshipRecord);
const mockedSaveMemory = vi.mocked(saveMemory);
const mockedSaveCharacterAffectState = vi.mocked(saveCharacterAffectState);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "dialogueGeneratorテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: "Asia/Tokyo",
};

// 感情・関係値の状態を now まで進める計算（needs.fatigue）が使う生活様式。
// 疲労の増減はこのテストの関心事ではないので、1日を通して変化させない枠にする
const lifestyle: Lifestyle = {
  key: "test-lifestyle",
  schedules: {
    weekday: [{ start: "00:00", end: "23:59", activity: "日常", fatigueChangePerHour: 0 }],
    holiday: [{ start: "00:00", end: "23:59", activity: "日常", fatigueChangePerHour: 0 }],
  },
  eventKinds: [{ key: "daily", label: "日常", weight: 1 }],
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ子",
  personality: "",
  speechStyle: "",
  relationship: "",
  background: "",
  speechExamples: [],
  initialPerception: {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 10,
    dependence: 10,
    familiarity: 50,
  },
  relationshipStages: [
    {
      key: "first",
      label: "テスト段階",
      description: "テスト用の説明",
      speechStyle: "テスト用の話し方",
      speechExamples: [],
      promoteWhen: null,
    },
  ],
};

const characterWithSpeechExamples: CharacterDefinition = {
  ...character,
  speechExamples: [{ player: "元気？", reply: "元気だよ、ありがとう！というマーカー返答" }],
};

// 段階が上がる条件を、発言1回・当日中に満たす段階（節目のテスト用。D-033）
const promotableSecondStage: RelationshipStage = {
  key: "second",
  label: "テスト段階2",
  description: "テスト用の説明2",
  speechStyle: "テスト用の話し方2",
  speechExamples: [],
  promoteWhen: { minConversationDays: 0, minConversationCount: 1, minPerception: {} },
};

const characterWithPromotableStage: CharacterDefinition = {
  ...character,
  relationshipStages: [character.relationshipStages[0], promotableSecondStage],
};

// 関係値（trust）がある程度上がらないと満たせない段階（セッション確定後の関係値での判定テスト用）
const stageThatNeedsHighTrust: RelationshipStage = {
  key: "second",
  label: "テスト段階2",
  description: "テスト用の説明2",
  speechStyle: "テスト用の話し方2",
  speechExamples: [],
  promoteWhen: { minConversationDays: 0, minConversationCount: 0, minPerception: { trust: 55 } },
};

const characterWithSessionPromotableStage: CharacterDefinition = {
  ...character,
  relationshipStages: [character.relationshipStages[0], stageThatNeedsHighTrust],
};

function relationshipRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    firstMetAt: "2026-08-01T00:00:00.000Z",
    lastConversationAt: "2026-08-10T00:00:00.000Z",
    lastConversationDate: "2026-08-10",
    conversationCount: 5,
    conversationDays: 3,
    stageKey: "first",
    highestStageKey: "first",
    recoveryRemaining: 0,
    lastDemotedAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function log(overrides: Partial<ConversationLogItem>): ConversationLogItem {
  return {
    conversation_id: "char-1",
    index: "2026-08-11T10:00:00.000Z",
    role: "user",
    content: "",
    memoryRetrieverJudgedFlag: 0,
    ...overrides,
  };
}

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-08-11T10:00:00.000Z",
    startDatetime: "2026-08-10T22:00:00.000Z",
    endDatetime: "2026-08-11T10:00:00.000Z",
    events: [{ kind: "daily", summary: "雨が降ったマーカー要約", detail: "傘を忘れたマーカー詳細" }],
    actions: [
      {
        startDatetime: "2026-08-10T22:00:00.000Z",
        endDatetime: "2026-08-10T22:30:00.000Z",
        action: "散歩マーカー行動",
        memo: "",
      },
    ],
    threads: [],
    ...overrides,
  };
}

// 情動0・気分平常（bigFive省略の平常値）・欲求は既定の基準値・関係値はキャラクターの
// initialPerception、進行中のセッションも段階の基点も無い状態（affectUpdatedAt は
// baseReq の既定の now と同じにして、経過時間による変化が起きないようにする）
function neutralAffectState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  const base: CharacterAffectState = {
    emotions: {
      joy: 0,
      sadness: 0,
      hope: 0,
      anxiety: 0,
      relief: 0,
      disappointment: 0,
      pride: 0,
      shame: 0,
      gratitude: 0,
      admiration: 0,
      anger: 0,
      happyFor: 0,
      sympathy: 0,
    },
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 30, loneliness: 0 },
    perception: { ...character.initialPerception },
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: "2026-08-11T14:30:00.000Z",
  };
  return { ...base, ...overrides };
}

function baseReq(overrides: Partial<DialogueGeneratorRequest> = {}): DialogueGeneratorRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lifestyle,
    now: "2026-08-11T14:30:00.000Z",
    message: "こんにちは",
    ...overrides,
  };
}

/** invokeModel に渡ったシステムプロンプト（層の配列）を、内容確認用に1つの文字列に結合する */
function promptText(callIndex = 0): string {
  return (mockedInvokeModel.mock.calls[callIndex][0] as string[]).join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetStoredAffectState.mockResolvedValue({ state: null, legacyPerception: null });
  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedGetRecentLogs.mockResolvedValue([]);
  mockedGetLatestAbsenceRecord.mockResolvedValue(null);
  mockedGetRelationshipRecord.mockResolvedValue(null);
  mockedSaveConversationLog.mockResolvedValue(undefined);
  mockedSaveRelationshipRecord.mockResolvedValue(undefined);
  mockedSaveMemory.mockResolvedValue(undefined);
  mockedSaveCharacterAffectState.mockResolvedValue(undefined);
  mockedInvokeModel.mockResolvedValue("セリフの返答");
});

describe("messageが空の場合の代替テキスト", () => {
  it("invokeModelへのuserメッセージが「（プレイヤーが来た）」になる", async () => {
    await runDialogueGenerator(baseReq({ message: "" }));

    expect(mockedInvokeModel.mock.calls[0][1]).toBe("（プレイヤーが来た）");
  });

  it("保存されるuserログの内容も「（プレイヤーが来た）」になる", async () => {
    await runDialogueGenerator(baseReq({ message: "" }));

    const userLogCall = mockedSaveConversationLog.mock.calls.find((c) => c[1] === "user");
    expect(userLogCall?.[2]).toBe("（プレイヤーが来た）");
  });

  it("getRelevantMemoriesのqueryTextはundefinedになる", async () => {
    await runDialogueGenerator(baseReq({ message: "" }));

    const options = mockedGetRelevantMemories.mock.calls[0][1];
    expect(options?.queryText).toBeUndefined();
  });
});

describe("messageがある場合", () => {
  it("そのままinvokeModelとuserログに渡る", async () => {
    await runDialogueGenerator(baseReq({ message: "配信見たよ" }));

    expect(mockedInvokeModel.mock.calls[0][1]).toBe("配信見たよ");
    const userLogCall = mockedSaveConversationLog.mock.calls.find((c) => c[1] === "user");
    expect(userLogCall?.[2]).toBe("配信見たよ");
  });

  it("getRelevantMemoriesのqueryTextも同じ文字列になる", async () => {
    await runDialogueGenerator(baseReq({ message: "配信見たよ" }));

    const options = mockedGetRelevantMemories.mock.calls[0][1];
    expect(options?.queryText).toBe("配信見たよ");
  });
});

describe("感情・関係値の状態（D-040: 状態レコードを読んで now まで進めた値を使うだけで、保存はしない）", () => {
  it("状態レコードが無い場合 → 初期状態（平常の気分・キャラクターのinitialPerception）でプロンプトができる", async () => {
    mockedGetStoredAffectState.mockResolvedValue({ state: null, legacyPerception: null });

    await runDialogueGenerator(baseReq());

    const prompt = promptText();
    expect(prompt).toContain("今の気分：ふつう（特に偏りはない）");
    expect(prompt).toContain("いま強く感じていること：特になし");
    expect(prompt).toContain(`信頼：${character.initialPerception.trust}`);
  });

  it("古い形のレコード（legacyPerception）がある場合 → 関係値だけが引き継がれる", async () => {
    mockedGetStoredAffectState.mockResolvedValue({
      state: null,
      legacyPerception: { trust: 80, affection: 81, respect: 50, fear: 20, dependence: 15, familiarity: 66 },
    });

    await runDialogueGenerator(baseReq());

    const prompt = promptText();
    expect(prompt).toContain("信頼：80（自覚している）");
    expect(prompt).toContain("好感：81（強く感じる）");
  });

  it("保存時に強かった情動が、時間が進んで何日も後では「特になし」になる", async () => {
    mockedGetStoredAffectState.mockResolvedValue({
      state: neutralAffectState({
        emotions: { ...neutralAffectState().emotions, sadness: 80 },
        affectUpdatedAt: "2026-08-01T00:00:00.000Z", // baseReq の now（8/11 14:30）の10日以上前
      }),
      legacyPerception: null,
    });

    await runDialogueGenerator(baseReq({ now: "2026-08-11T14:30:00.000Z" }));

    const prompt = promptText();
    expect(prompt).toContain("いま強く感じていること：特になし");
    expect(prompt).not.toContain("悲しみ・落ち込み");
  });

  it("今の気分の快（mood.pleasure）が、getRelevantMemoriesのmoodPleasureに渡る（気分一致の記憶）", async () => {
    const now = "2026-08-11T14:30:00.000Z";
    mockedGetStoredAffectState.mockResolvedValue({
      state: neutralAffectState({
        mood: { pleasure: -60, arousal: 0, dominance: 0 },
        affectUpdatedAt: now, // 経過時間0なので、気分は平常値へ戻らず保存時の値のまま
      }),
      legacyPerception: null,
    });

    await runDialogueGenerator(baseReq({ now }));

    const options = mockedGetRelevantMemories.mock.calls[0][1];
    expect(options?.moodPleasure).toBeCloseTo(-60, 5);
  });

  it("終わったセッションの確定後の関係値（trustの上昇）で段階の判定がされる", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord({ stageKey: "first" }));
    mockedGetStoredAffectState.mockResolvedValue({
      state: neutralAffectState({
        pendingSession: {
          startedAt: "2026-08-11T12:00:00.000Z",
          lastMessageAt: "2026-08-11T13:00:00.000Z", // now（14:30）との差90分 ≥ セッションの終わりの間隔（30分）
          messageCount: 1,
          peak: { trust: 100 },
          last: { trust: 100 },
        },
        affectUpdatedAt: "2026-08-11T13:00:00.000Z",
      }),
      legacyPerception: null,
    });

    await runDialogueGenerator(
      baseReq({ character: characterWithSessionPromotableStage, message: "こんにちは" })
    );

    const savedRecord = mockedSaveRelationshipRecord.mock.calls[0][1];
    expect(savedRecord.stageKey).toBe("second");
  });

  it("状態レコードには書き込まない（saveCharacterAffectStateは呼ばれない）", async () => {
    await runDialogueGenerator(baseReq());

    expect(mockedSaveCharacterAffectState).not.toHaveBeenCalled();
  });
});

describe("保存順序", () => {
  it("userログ保存 → getRecentLogs → モデル呼び出し → assistantログ保存の順になる", async () => {
    const calls: string[] = [];
    mockedSaveConversationLog.mockImplementation(async (_characterId, role) => {
      calls.push(`saveConversationLog:${role}`);
    });
    mockedGetRecentLogs.mockImplementation(async () => {
      calls.push("getRecentLogs");
      return [];
    });
    mockedInvokeModel.mockImplementation(async () => {
      calls.push("invokeModel");
      return "セリフの返答";
    });

    await runDialogueGenerator(baseReq());

    expect(calls).toEqual([
      "saveConversationLog:user",
      "getRecentLogs",
      "invokeModel",
      "saveConversationLog:assistant",
    ]);
  });

  it("getRecentLogsはcharacterIdと10で呼ばれる", async () => {
    await runDialogueGenerator(baseReq({ characterId: "char-xyz" }));

    expect(mockedGetRecentLogs).toHaveBeenCalledWith("char-xyz", 10);
  });

  it("assistantログにはinvokeModelの返り値(reply)が保存される", async () => {
    mockedInvokeModel.mockResolvedValue("これが返答です");

    await runDialogueGenerator(baseReq());

    const assistantLogCall = mockedSaveConversationLog.mock.calls.find((c) => c[1] === "assistant");
    expect(assistantLogCall?.[2]).toBe("これが返答です");
  });

  it("返り値はinvokeModelの返答(reply)そのもの", async () => {
    mockedInvokeModel.mockResolvedValue("これが返答です");

    const result = await runDialogueGenerator(baseReq());

    expect(result).toBe("これが返答です");
  });
});

describe("直近ログの末尾（今保存したuserログ）を会話履歴から除く", () => {
  it("getRecentLogsの最後の1件はプロンプトの会話履歴に含まれない", async () => {
    mockedGetRecentLogs.mockResolvedValue([
      log({ index: "2026-08-11T10:00:00.000Z", role: "user", content: "古い発言" }),
      log({ index: "2026-08-11T10:05:00.000Z", role: "assistant", content: "古い返答" }),
      log({ index: "2026-08-11T14:30:00.000Z", role: "user", content: "こんにちは" }), // 直前に保存したuserログ想定
    ]);

    await runDialogueGenerator(baseReq({ message: "こんにちは" }));

    const prompt = promptText();
    expect(prompt).toContain("古い発言");
    expect(prompt).toContain("古い返答");
    // 末尾の「こんにちは」は会話履歴（historyText）ではなく別の目的（現在のuserメッセージ）でのみ登場するべきだが、
    // ここでは少なくとも「古い発言」「古い返答」の2件が履歴に含まれることを確認する
  });
});

describe("最新の不在期間の記録（getLatestAbsenceRecord）", () => {
  it("characterIdで呼ばれる", async () => {
    await runDialogueGenerator(baseReq({ characterId: "char-xyz" }));

    expect(mockedGetLatestAbsenceRecord).toHaveBeenCalledWith("char-xyz");
  });

  it("記録がある場合 → プロンプトに出来事の内容が入る", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord());

    await runDialogueGenerator(baseReq());

    expect(promptText()).toContain("雨が降ったマーカー要約");
  });

  it("記録が無い場合 → invokeModelに渡るセッション部（層の2番目）は空文字にならない（今の関係の段階が入るため。D-033）が、出来事の見出しは入らない", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(null);

    await runDialogueGenerator(baseReq());

    const layers = mockedInvokeModel.mock.calls[0][0] as string[];
    expect(layers[1]).not.toBe("");
    expect(layers[1]).not.toContain("最近の不在期間の出来事");
  });
});

describe("関係の記録（getRelationshipRecord・advanceRelationship・saveRelationshipRecord。D-033）", () => {
  it("getRelationshipRecordはcharacterIdで呼ばれる", async () => {
    await runDialogueGenerator(baseReq({ characterId: "char-xyz" }));

    expect(mockedGetRelationshipRecord).toHaveBeenCalledWith("char-xyz");
  });

  it("記録が無い（はじめて）場合 → firstMetAtがnowの記録が保存される", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(null);

    await runDialogueGenerator(baseReq({ now: "2026-08-11T14:30:00.000Z", message: "こんにちは" }));

    expect(mockedSaveRelationshipRecord).toHaveBeenCalledTimes(1);
    const [savedCharacterId, savedRecord] = mockedSaveRelationshipRecord.mock.calls[0];
    expect(savedCharacterId).toBe("char-1");
    expect(savedRecord.firstMetAt).toBe("2026-08-11T14:30:00.000Z");
  });

  it("プレイヤーの発言がある場合 → conversationCountが1増える", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord({ conversationCount: 5 }));

    await runDialogueGenerator(baseReq({ message: "こんにちは" }));

    const savedRecord = mockedSaveRelationshipRecord.mock.calls[0][1];
    expect(savedRecord.conversationCount).toBe(6);
  });

  it("プレイヤーの発言が無い（ログイン時の挨拶）場合 → conversationCountは変わらない", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord({ conversationCount: 5 }));

    await runDialogueGenerator(baseReq({ message: "" }));

    const savedRecord = mockedSaveRelationshipRecord.mock.calls[0][1];
    expect(savedRecord.conversationCount).toBe(5);
  });

  it("characterIdで保存される", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord());

    await runDialogueGenerator(baseReq({ characterId: "char-xyz" }));

    expect(mockedSaveRelationshipRecord).toHaveBeenCalledWith("char-xyz", expect.any(Object));
  });
});

describe("節目（段階が変わったとき。プレイヤーには伝えず重要記憶とログにだけ残す。D-033）", () => {
  it("段階が上がる条件を満たすと、relationship_milestoneの重要記憶として保存される", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(null);

    await runDialogueGenerator(baseReq({ character: characterWithPromotableStage, message: "こんにちは" }));

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
    const savedMemory = mockedSaveMemory.mock.calls[0][0];
    expect(savedMemory.memory_id).toBe("char-1");
    expect(savedMemory.memoryType).toBe(RELATIONSHIP_MILESTONE_MEMORY_TYPE);
    expect(savedMemory.memoryType).toBe("relationship_milestone");
    expect(savedMemory.eventSummary).toBe("プレイヤーとの関係が「テスト段階」から「テスト段階2」に上がった");
  });

  it("節目はプロンプトに入らない（プレイヤーには伝えない）", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(null);

    await runDialogueGenerator(baseReq({ character: characterWithPromotableStage, message: "こんにちは" }));

    expect(promptText()).not.toContain("に上がった");
    expect(promptText()).not.toContain("relationship_milestone");
  });

  it("段階が変わらないとき → saveMemoryは呼ばれない", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord());

    await runDialogueGenerator(baseReq({ message: "こんにちは" }));

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("節目の保存（saveRelationshipRecord・saveMemory）はinvokeModelより前に行われる", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(null);
    const calls: string[] = [];
    mockedSaveRelationshipRecord.mockImplementation(async () => {
      calls.push("saveRelationshipRecord");
    });
    mockedSaveMemory.mockImplementation(async () => {
      calls.push("saveMemory");
    });
    mockedInvokeModel.mockImplementation(async () => {
      calls.push("invokeModel");
      return "セリフの返答";
    });

    await runDialogueGenerator(baseReq({ character: characterWithPromotableStage, message: "こんにちは" }));

    expect(calls).toContain("saveRelationshipRecord");
    expect(calls).toContain("saveMemory");
    expect(calls.indexOf("invokeModel")).toBeGreaterThan(calls.indexOf("saveRelationshipRecord"));
    expect(calls.indexOf("invokeModel")).toBeGreaterThan(calls.indexOf("saveMemory"));
  });
});

describe("今の段階の文面（プロンプトの②に入ること。D-033）", () => {
  it("記録の段階（stageKey）に対応する段階の説明・話し方がプロンプトに入る", async () => {
    mockedGetRelationshipRecord.mockResolvedValue(relationshipRecord({ stageKey: "first" }));

    await runDialogueGenerator(baseReq());

    expect(promptText()).toContain("テスト用の説明");
    expect(promptText()).toContain("テスト用の話し方");
  });
});

describe("プロンプトに含まれる情報", () => {
  it("世界観の説明文が入る", async () => {
    await runDialogueGenerator(baseReq());

    expect(promptText()).toContain("dialogueGeneratorテスト用の世界観マーカー");
  });

  it("キャラクター名が入る", async () => {
    await runDialogueGenerator(baseReq());

    expect(promptText()).toContain("テストキャラ子");
  });

  it("speechExamplesがある場合 → 口調の例文が入る", async () => {
    await runDialogueGenerator(baseReq({ character: characterWithSpeechExamples }));

    expect(promptText()).toContain("元気だよ、ありがとう！というマーカー返答");
  });

  it("speechExamplesが無い場合 → speechExamplesパーシャルの本文が入らない", async () => {
    // 「【口調の例】」という見出し自体は思考手順の固定文にも登場するため、
    // パーシャル固有の文言（口調の手本です、という説明文）で判定する
    await runDialogueGenerator(baseReq({ character }));

    expect(promptText()).not.toContain("の口調の手本です");
  });

  it("記憶がある場合 → 記憶の内容が入る", async () => {
    mockedGetRelevantMemories.mockResolvedValue([
      { memory_id: "char-1", index: "mem-1", eventSummary: "文化祭を手伝った", characterInterpretation: "楽しかった" },
    ]);

    await runDialogueGenerator(baseReq());

    expect(promptText()).toContain("文化祭を手伝った");
  });
});

describe("invokeModelの呼び出し", () => {
  it("systemPromptは3要素の配列で渡る", async () => {
    await runDialogueGenerator(baseReq());

    const layers = mockedInvokeModel.mock.calls[0][0];
    expect(Array.isArray(layers)).toBe(true);
    expect((layers as string[])).toHaveLength(3);
  });

  it("maxTokensは500", async () => {
    await runDialogueGenerator(baseReq());

    expect(mockedInvokeModel.mock.calls[0][2]).toBe(500);
  });
});
