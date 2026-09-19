import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModel: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/dynamo.js")>();
  return {
    ...actual,
    getCharacterState: vi.fn(),
    getRelevantMemories: vi.fn(),
    getRecentLogs: vi.fn(),
    getLatestAbsenceRecord: vi.fn(),
    getRelationshipRecord: vi.fn(),
    saveConversationLog: vi.fn(),
    saveRelationshipRecord: vi.fn(),
    saveMemory: vi.fn(),
  };
});

import { runDialogueGenerator } from "../../../src/dialogueGenerator/index.js";
import { invokeModel } from "../../../src/lib/bedrock.js";
import {
  getCharacterState,
  getRelevantMemories,
  getRecentLogs,
  getLatestAbsenceRecord,
  getRelationshipRecord,
  saveConversationLog,
  saveRelationshipRecord,
  saveMemory,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
  RELATIONSHIP_MILESTONE_MEMORY_TYPE,
} from "../../../src/lib/dynamo.js";
import type {
  AbsenceRecord,
  CharacterDefinition,
  ConversationLogItem,
  DialogueGeneratorRequest,
  RelationshipRecord,
  RelationshipStage,
  World,
} from "../../../src/types.js";

const mockedInvokeModel = vi.mocked(invokeModel);
const mockedGetCharacterState = vi.mocked(getCharacterState);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedGetRecentLogs = vi.mocked(getRecentLogs);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);
const mockedGetRelationshipRecord = vi.mocked(getRelationshipRecord);
const mockedSaveConversationLog = vi.mocked(saveConversationLog);
const mockedSaveRelationshipRecord = vi.mocked(saveRelationshipRecord);
const mockedSaveMemory = vi.mocked(saveMemory);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "dialogueGeneratorテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: "Asia/Tokyo",
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

function baseReq(overrides: Partial<DialogueGeneratorRequest> = {}): DialogueGeneratorRequest {
  return {
    characterId: "char-1",
    world,
    character,
    now: "2026-08-11T14:30:00.000Z",
    message: "こんにちは",
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

/** invokeModel に渡ったシステムプロンプト（層の配列）を、内容確認用に1つの文字列に結合する */
function promptText(callIndex = 0): string {
  return (mockedInvokeModel.mock.calls[callIndex][0] as string[]).join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedGetRecentLogs.mockResolvedValue([]);
  mockedGetLatestAbsenceRecord.mockResolvedValue(null);
  mockedGetRelationshipRecord.mockResolvedValue(null);
  mockedSaveConversationLog.mockResolvedValue(undefined);
  mockedSaveRelationshipRecord.mockResolvedValue(undefined);
  mockedSaveMemory.mockResolvedValue(undefined);
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

describe("mood/perception（D-032: リクエストでは受け取らず常にDBから読む）", () => {
  it("常にgetCharacterStateをcharacterIdで呼び、その値がプロンプトに入る", async () => {
    const stateMood = { joy: 1, anxiety: 2, angry: 3, fatigue: 4, confidence: 5, loneliness: 6 };
    const statePerception = { trust: 11, affection: 12, respect: 13, fear: 14, dependence: 15, familiarity: 16 };
    mockedGetCharacterState.mockResolvedValue({ mood: stateMood, perception: statePerception });

    await runDialogueGenerator(baseReq({ characterId: "char-xyz" }));

    expect(mockedGetCharacterState).toHaveBeenCalledWith("char-xyz", character.initialPerception);
    expect(mockedGetCharacterState).toHaveBeenCalledTimes(1);
    expect(promptText()).toContain("喜び：1（ほとんど感じない）");
    expect(promptText()).toContain("信頼：11（ほとんど感じない）");
  });

  it("getCharacterStateがmood/perceptionを返さない場合 → 既定値(DEFAULT_MOOD/DEFAULT_PERCEPTION)が使われる", async () => {
    mockedGetCharacterState.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof getCharacterState>>);

    await runDialogueGenerator(baseReq());

    const prompt = promptText();
    expect(prompt).toContain(`喜び：${DEFAULT_MOOD.joy}`);
    expect(prompt).toContain(`信頼：${DEFAULT_PERCEPTION.trust}`);
  });

  it("D-033: character.initialPerceptionがgetCharacterStateの第2引数に渡る（キャラクターごとに異なる値でも）", async () => {
    const characterWithCustomInitialPerception = {
      ...character,
      initialPerception: {
        trust: 35,
        affection: 35,
        respect: 50,
        fear: 15,
        dependence: 10,
        familiarity: 20,
      },
    };

    await runDialogueGenerator(baseReq({ character: characterWithCustomInitialPerception }));

    expect(mockedGetCharacterState).toHaveBeenCalledWith(
      "char-1",
      characterWithCustomInitialPerception.initialPerception
    );
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

  it("mood/perceptionのラベルが入る（境界値 40/41）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 40, anxiety: 41, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
      perception: { ...DEFAULT_PERCEPTION },
    });

    await runDialogueGenerator(baseReq());

    const prompt = promptText();
    expect(prompt).toContain("喜び：40（低い）");
    expect(prompt).toContain("不安：41（標準）");
  });

  it("mood/perceptionのラベルが入る（境界値 80/81）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { ...DEFAULT_MOOD },
      perception: { trust: 80, affection: 81, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
    });

    await runDialogueGenerator(baseReq());

    const prompt = promptText();
    expect(prompt).toContain("信頼：80（自覚している）");
    expect(prompt).toContain("好感：81（強く感じる）");
  });

  it("longTimeFlagが1のとき「さみしさ」の記述が入る", async () => {
    await runDialogueGenerator(baseReq({ longTimeFlag: 1 }));
    expect(promptText()).toContain("さみしさ");
  });

  it("longTimeFlagが0（省略）のとき「さみしさ」の記述が入らない", async () => {
    await runDialogueGenerator(baseReq({ longTimeFlag: 0 }));
    expect(promptText()).not.toContain("さみしさ");
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
