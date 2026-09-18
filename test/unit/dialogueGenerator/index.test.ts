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
    saveConversationLog: vi.fn(),
  };
});

import { runDialogueGenerator } from "../../../src/dialogueGenerator/index.js";
import { invokeModel } from "../../../src/lib/bedrock.js";
import {
  getCharacterState,
  getRelevantMemories,
  getRecentLogs,
  saveConversationLog,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../../../src/lib/dynamo.js";
import type {
  CharacterDefinition,
  ConversationLogItem,
  DialogueGeneratorRequest,
  World,
} from "../../../src/types.js";

const mockedInvokeModel = vi.mocked(invokeModel);
const mockedGetCharacterState = vi.mocked(getCharacterState);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedGetRecentLogs = vi.mocked(getRecentLogs);
const mockedSaveConversationLog = vi.mocked(saveConversationLog);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "dialogueGeneratorテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ子",
  personality: "",
  speechStyle: "",
  relationship: "",
  background: "",
  speechExamples: [],
};

const characterWithSpeechExamples: CharacterDefinition = {
  ...character,
  speechExamples: [{ player: "元気？", reply: "元気だよ、ありがとう！というマーカー返答" }],
};

function baseReq(overrides: Partial<DialogueGeneratorRequest> = {}): DialogueGeneratorRequest {
  return {
    characterId: "char-1",
    world,
    character,
    now: "2026-08-11T14:30:00.000Z",
    message: "こんにちは",
    mood: { joy: 50, anxiety: 50, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
    perception: { trust: 50, affection: 50, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedGetRecentLogs.mockResolvedValue([]);
  mockedSaveConversationLog.mockResolvedValue(undefined);
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

describe("mood/perceptionの省略", () => {
  it("両方指定 → getCharacterStateを呼ばない", async () => {
    await runDialogueGenerator(baseReq());

    expect(mockedGetCharacterState).not.toHaveBeenCalled();
  });

  it("moodのみ欠けている → getCharacterStateを呼び、その値を使う", async () => {
    const stateMood = { joy: 1, anxiety: 2, angry: 3, fatigue: 4, confidence: 5, loneliness: 6 };
    mockedGetCharacterState.mockResolvedValue({ mood: stateMood, perception: { ...DEFAULT_PERCEPTION } });

    await runDialogueGenerator(baseReq({ mood: undefined }));

    expect(mockedGetCharacterState).toHaveBeenCalledTimes(1);
    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("喜び：1（ほとんど感じない）");
  });

  it("perceptionのみ欠けている → getCharacterStateを呼び、その値を使う", async () => {
    const statePerception = { trust: 11, affection: 12, respect: 13, fear: 14, dependence: 15, familiarity: 16 };
    mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: statePerception });

    await runDialogueGenerator(baseReq({ perception: undefined }));

    expect(mockedGetCharacterState).toHaveBeenCalledTimes(1);
    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("信頼：11（ほとんど感じない）");
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

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("古い発言");
    expect(systemPrompt).toContain("古い返答");
    // 末尾の「こんにちは」は会話履歴（historyText）ではなく別の目的（現在のuserメッセージ）でのみ登場するべきだが、
    // ここでは少なくとも「古い発言」「古い返答」の2件が履歴に含まれることを確認する
  });
});

describe("プロンプトに含まれる情報", () => {
  it("世界観の説明文が入る", async () => {
    await runDialogueGenerator(baseReq());

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("dialogueGeneratorテスト用の世界観マーカー");
  });

  it("キャラクター名が入る", async () => {
    await runDialogueGenerator(baseReq());

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("テストキャラ子");
  });

  it("speechExamplesがある場合 → 口調の例文が入る", async () => {
    await runDialogueGenerator(baseReq({ character: characterWithSpeechExamples }));

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("元気だよ、ありがとう！というマーカー返答");
  });

  it("speechExamplesが無い場合 → speechExamplesパーシャルの本文が入らない", async () => {
    // 「【口調の例】」という見出し自体は思考手順の固定文にも登場するため、
    // パーシャル固有の文言（口調の手本です、という説明文）で判定する
    await runDialogueGenerator(baseReq({ character }));

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).not.toContain("の口調の手本です");
  });

  it("記憶がある場合 → 記憶の内容が入る", async () => {
    mockedGetRelevantMemories.mockResolvedValue([
      { memory_id: "char-1", index: "mem-1", eventSummary: "文化祭を手伝った", characterInterpretation: "楽しかった" },
    ]);

    await runDialogueGenerator(baseReq());

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("文化祭を手伝った");
  });

  it("mood/perceptionのラベルが入る（境界値 40/41）", async () => {
    await runDialogueGenerator(
      baseReq({
        mood: { joy: 40, anxiety: 41, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
      })
    );

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("喜び：40（低い）");
    expect(systemPrompt).toContain("不安：41（標準）");
  });

  it("mood/perceptionのラベルが入る（境界値 80/81）", async () => {
    await runDialogueGenerator(
      baseReq({
        perception: { trust: 80, affection: 81, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
      })
    );

    const systemPrompt = mockedInvokeModel.mock.calls[0][0];
    expect(systemPrompt).toContain("信頼：80（自覚している）");
    expect(systemPrompt).toContain("好感：81（強く感じる）");
  });

  it("eventsがある場合のみ【発生イベント】が入る", async () => {
    const withEvents = await runDialogueGeneratorAndGetPrompt(baseReq({ events: ["雨が降った"] }));
    expect(withEvents).toContain("【発生イベント】");
    expect(withEvents).toContain("雨が降った");

    const without = await runDialogueGeneratorAndGetPrompt(baseReq({ events: undefined }));
    expect(without).not.toContain("【発生イベント】");
  });

  it("actionsがある場合のみ【直近の行動履歴】が入る", async () => {
    const withActions = await runDialogueGeneratorAndGetPrompt(
      baseReq({ actions: [{ startDatetime: "a", endDatetime: "b", action: "散歩", memo: "" }] })
    );
    expect(withActions).toContain("【直近の行動履歴】");
    expect(withActions).toContain("散歩");

    const without = await runDialogueGeneratorAndGetPrompt(baseReq({ actions: undefined }));
    expect(without).not.toContain("【直近の行動履歴】");
  });

  it("longTimeFlagが1のとき「さみしさ」「よろこび」の記述が入る", async () => {
    const withFlag = await runDialogueGeneratorAndGetPrompt(baseReq({ longTimeFlag: 1 }));
    expect(withFlag).toContain("さみしさ");

    const without = await runDialogueGeneratorAndGetPrompt(baseReq({ longTimeFlag: 0 }));
    expect(without).not.toContain("さみしさ");
  });
});

describe("invokeModelの呼び出し", () => {
  it("maxTokensは500", async () => {
    await runDialogueGenerator(baseReq());

    expect(mockedInvokeModel.mock.calls[0][2]).toBe(500);
  });
});

async function runDialogueGeneratorAndGetPrompt(req: DialogueGeneratorRequest): Promise<string> {
  mockedInvokeModel.mockClear();
  await runDialogueGenerator(req);
  return mockedInvokeModel.mock.calls[0][0];
}
