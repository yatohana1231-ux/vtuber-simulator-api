import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getRelevantMemories: vi.fn(),
  getLogsForMemoryJudge: vi.fn(),
  markLogsAsJudged: vi.fn(),
  saveMemory: vi.fn(),
}));

import { runMemoryRetriever } from "../../../src/memoryRetriever/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import {
  getRelevantMemories,
  getLogsForMemoryJudge,
  markLogsAsJudged,
  saveMemory,
} from "../../../src/lib/dynamo.js";
import type {
  CharacterDefinition,
  ConversationLogItem,
  MemoryCandidate,
  MemoryRetrieverRequest,
  MemoryRetrieverResult,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedGetLogsForMemoryJudge = vi.mocked(getLogsForMemoryJudge);
const mockedMarkLogsAsJudged = vi.mocked(markLogsAsJudged);
const mockedSaveMemory = vi.mocked(saveMemory);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "memoryRetrieverテスト用の世界観マーカー",
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

function process1Req(overrides: Partial<MemoryRetrieverRequest> = {}): MemoryRetrieverRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 1,
    events: [],
    actions: [],
    ...overrides,
  } as MemoryRetrieverRequest;
}

function process2Req(overrides: Partial<MemoryRetrieverRequest> = {}): MemoryRetrieverRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 2,
    ...overrides,
  } as MemoryRetrieverRequest;
}

function candidate(overrides: Partial<MemoryCandidate & { memoryLabel: string }> = {}): MemoryCandidate & { memoryLabel: string } {
  return {
    shouldRemember: true,
    eventSummary: "出来事の要約",
    playerAction: "",
    characterInterpretation: "解釈",
    emotion: "うれしい",
    importance: 60,
    memoryType: "relationship_event",
    memoryLabel: "CREATE",
    tags: ["配信"],
    relationshipChanges: { trust: 1, affection: 1, respect: 0 },
    reason: "理由",
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

function tenUnjudgedLogs(): ConversationLogItem[] {
  return Array.from({ length: 10 }, (_, i) =>
    log({
      index: `2026-08-11T10:0${i}:00.000Z`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `発言${i}`,
      memoryRetrieverJudgedFlag: 0,
    })
  );
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedGetLogsForMemoryJudge.mockResolvedValue([]);
  mockedMarkLogsAsJudged.mockResolvedValue(undefined);
  mockedSaveMemory.mockResolvedValue(undefined);
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("process1: イベント・行動の有無による分岐", () => {
  it("eventsもactionsも空 → モデルもDynamoDBも呼ばない", async () => {
    await runMemoryRetriever(process1Req({ events: [], actions: [] }));

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedGetRelevantMemories).not.toHaveBeenCalled();
    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("eventsのみある → モデルを呼ぶ", async () => {
    await runMemoryRetriever(process1Req({ events: ["雨が降った"], actions: [] }));

    expect(mockedInvokeModelJson).toHaveBeenCalledTimes(1);
  });

  it("actionsのみある → モデルを呼ぶ", async () => {
    await runMemoryRetriever(
      process1Req({
        events: [],
        actions: [{ startDatetime: "a", endDatetime: "b", action: "散歩", memo: "" }],
      })
    );

    expect(mockedInvokeModelJson).toHaveBeenCalledTimes(1);
  });
});

describe("process2: 会話ログの件数・判定済みフラグによる分岐", () => {
  it("ログが10件未満 → スキップ（モデル・markLogsAsJudgedを呼ばない）", async () => {
    mockedGetLogsForMemoryJudge.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => log({ index: `idx-${i}` }))
    );

    await runMemoryRetriever(process2Req());

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedMarkLogsAsJudged).not.toHaveBeenCalled();
  });

  it("10件そろっているが判定済みフラグ1のログを含む → スキップ", async () => {
    const logs = tenUnjudgedLogs();
    logs[3] = { ...logs[3], memoryRetrieverJudgedFlag: 1 };
    mockedGetLogsForMemoryJudge.mockResolvedValue(logs);

    await runMemoryRetriever(process2Req());

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedMarkLogsAsJudged).not.toHaveBeenCalled();
  });

  it("10件そろって未判定 → モデルを呼び、会話内容（プレイヤー名・キャラクター名）がプロンプトに入る", async () => {
    const logs = tenUnjudgedLogs();
    logs[0] = { ...logs[0], role: "user", content: "配信見たよ" };
    logs[1] = { ...logs[1], role: "assistant", content: "ありがとうございます！" };
    mockedGetLogsForMemoryJudge.mockResolvedValue(logs);

    await runMemoryRetriever(process2Req());

    expect(mockedInvokeModelJson).toHaveBeenCalledTimes(1);
    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("プレイヤー: 配信見たよ");
    expect(systemPrompt).toContain("テストキャラ子: ありがとうございます！");
  });

  it("10件そろって未判定 → markLogsAsJudgedに全ログのindexが渡る", async () => {
    const logs = tenUnjudgedLogs();
    mockedGetLogsForMemoryJudge.mockResolvedValue(logs);

    await runMemoryRetriever(process2Req());

    expect(mockedMarkLogsAsJudged).toHaveBeenCalledTimes(1);
    expect(mockedMarkLogsAsJudged).toHaveBeenCalledWith(
      "char-1",
      logs.map((l) => l.index)
    );
  });

  it("getLogsForMemoryJudgeは(characterId, 5)で呼ばれる", async () => {
    await runMemoryRetriever(process2Req({ characterId: "char-xyz" }));

    expect(mockedGetLogsForMemoryJudge).toHaveBeenCalledWith("char-xyz", 5);
  });
});

describe("保存対象の絞り込み", () => {
  it("shouldRemember:true かつ memoryLabelがIGNORE以外 → 保存される", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ memoryLabel: "CREATE" })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
  });

  it("shouldRemember:false → 保存されない", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ shouldRemember: false })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("shouldRemember:true でも memoryLabelがIGNORE → 保存されない", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ memoryLabel: "IGNORE" })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("candidatesが配列でない → 何も保存しない", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: "not-an-array" } as never);

    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("fallback（invokeModelJsonが第3引数をそのまま返す） → 何も保存しない", async () => {
    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("saveMemoryのitemにmemory_id・eventSummary・importance・tagsなどが入る", async () => {
    const c = candidate({
      eventSummary: "文化祭の準備を手伝った",
      importance: 77,
      tags: ["文化祭", "手伝い"],
    });
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: [c] });

    await runMemoryRetriever(process1Req({ characterId: "char-xyz", events: ["雨が降った"] }));

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
    const item = mockedSaveMemory.mock.calls[0][0];
    expect(item.memory_id).toBe("char-xyz");
    expect(item.eventSummary).toBe("文化祭の準備を手伝った");
    expect(item.importance).toBe(77);
    expect(item.tags).toEqual(["文化祭", "手伝い"]);
    expect(typeof item.index).toBe("string");
    expect(typeof item.updatedAt).toBe("string");
  });
});

describe("getRelevantMemoriesの呼び出し条件", () => {
  it("queryText・topK:20・minImportance:10で呼ばれる", async () => {
    await runMemoryRetriever(process1Req({ events: ["雨が降った"] }));

    expect(mockedGetRelevantMemories).toHaveBeenCalledTimes(1);
    const [characterId, options] = mockedGetRelevantMemories.mock.calls[0];
    expect(characterId).toBe("char-1");
    expect(options).toMatchObject({ topK: 20, minImportance: 10 });
    expect(typeof options?.queryText).toBe("string");
    expect(options?.queryText).toContain("雨が降った");
  });
});

describe("型と実装の食い違い（現状の挙動）", () => {
  // MemoryCandidate 型（src/types.ts）には memoryLabel フィールドが定義されていないが、
  // 実装（src/memoryRetriever/index.ts）は `(c as MemoryCandidate & { memoryLabel?: string }).memoryLabel`
  // というキャストで参照している。プロンプト（memoryRetriever.mustache）はモデルに
  // memoryLabel を出力させる指示をしているため実行時には動作するが、型定義上は
  // MemoryCandidate に memoryLabel が存在せず、型チェックだけでは保存フィルタの実際の
  // 条件（IGNORE 除外）を追跡できない。
  it.todo(
    "MemoryCandidate型にmemoryLabelを追加する対応は本フェーズの対象外（src/を変更しないため）。型定義を実装に合わせるかどうかは別途検討"
  );
});
