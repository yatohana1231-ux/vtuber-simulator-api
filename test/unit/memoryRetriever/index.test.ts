import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getRelevantMemories: vi.fn(),
  getLatestAbsenceRecord: vi.fn(),
  getLogsForMemoryJudge: vi.fn(),
  markLogsAsJudged: vi.fn(),
  saveMemory: vi.fn(),
}));

import { runMemoryRetriever } from "../../../src/memoryRetriever/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import {
  getRelevantMemories,
  getLatestAbsenceRecord,
  getLogsForMemoryJudge,
  markLogsAsJudged,
  saveMemory,
} from "../../../src/lib/dynamo.js";
import { formatLocalDateTime } from "../../../src/lib/timezone.js";
import type {
  AbsenceRecord,
  CharacterDefinition,
  ConversationLogItem,
  MemoryCandidate,
  MemoryRetrieverRequest,
  MemoryRetrieverResult,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);
const mockedGetLogsForMemoryJudge = vi.mocked(getLogsForMemoryJudge);
const mockedMarkLogsAsJudged = vi.mocked(markLogsAsJudged);
const mockedSaveMemory = vi.mocked(saveMemory);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "memoryRetrieverテスト用の世界観マーカー",
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

function process1Req(overrides: Partial<MemoryRetrieverRequest> = {}): MemoryRetrieverRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 1,
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

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-08-11T08:00:00.000Z",
    startDatetime: "2026-08-11T00:00:00.000Z",
    endDatetime: "2026-08-11T08:00:00.000Z",
    events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }],
    actions: [
      {
        startDatetime: "2026-08-11T06:00:00.000Z",
        endDatetime: "2026-08-11T07:00:00.000Z",
        action: "散歩した",
        memo: "",
      },
    ],
    threads: [],
    ...overrides,
  };
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

/** invokeModelJson に渡ったシステムプロンプト（層の配列）を1つの文字列に結合して返す */
function joinedPrompt(callIndex = 0): string {
  const systemPrompt = mockedInvokeModelJson.mock.calls[callIndex][0];
  return Array.isArray(systemPrompt) ? systemPrompt.join("\n") : systemPrompt;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord());
  mockedGetLogsForMemoryJudge.mockResolvedValue([]);
  mockedMarkLogsAsJudged.mockResolvedValue(undefined);
  mockedSaveMemory.mockResolvedValue(undefined);
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("process1: 最新の不在期間の記録（D-022）", () => {
  it("記録が無い → モデルもDynamoDBも呼ばない", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(null);

    await runMemoryRetriever(process1Req());

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedGetRelevantMemories).not.toHaveBeenCalled();
    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("記録がある → characterIdでgetLatestAbsenceRecordが呼ばれ、モデルを呼ぶ", async () => {
    await runMemoryRetriever(process1Req({ characterId: "char-xyz" }));

    expect(mockedGetLatestAbsenceRecord).toHaveBeenCalledWith("char-xyz");
    expect(mockedInvokeModelJson).toHaveBeenCalledTimes(1);
  });

  it("記録の出来事のsummary・detailがプロンプトに入る", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(
      absenceRecord({ events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }] })
    );

    await runMemoryRetriever(process1Req());

    const prompt = joinedPrompt();
    expect(prompt).toContain("雨が降った");
    expect(prompt).toContain("傘を忘れて濡れた");
  });

  it("記録の行動の日時が、世界観のタイムゾーン表記で入る（UTCのslice(0,16)ではない）", async () => {
    const action = {
      startDatetime: "2026-08-11T06:00:00.000Z",
      endDatetime: "2026-08-11T07:00:00.000Z",
      action: "散歩した",
      memo: "",
    };
    mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord({ actions: [action] }));

    await runMemoryRetriever(process1Req());

    const prompt = joinedPrompt();
    const start = formatLocalDateTime(new Date(action.startDatetime), world.timezone);
    const end = formatLocalDateTime(new Date(action.endDatetime), world.timezone);
    expect(prompt).toContain(`${start}〜${end} ${action.action}`);
    expect(prompt).not.toContain(action.startDatetime.slice(0, 16));
  });

  it("invokeModelJsonに層の配列（[固定部, 可変部]）が渡る", async () => {
    await runMemoryRetriever(process1Req());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(Array.isArray(systemPrompt)).toBe(true);
    expect(systemPrompt).toHaveLength(2);
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
    const prompt = joinedPrompt();
    expect(prompt).toContain("プレイヤー: 配信見たよ");
    expect(prompt).toContain("テストキャラ子: ありがとうございます！");
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

  it("getLatestAbsenceRecordを呼ばない", async () => {
    await runMemoryRetriever(process2Req());

    expect(mockedGetLatestAbsenceRecord).not.toHaveBeenCalled();
  });
});

describe("保存対象の絞り込み", () => {
  it("shouldRemember:true かつ memoryLabelがIGNORE以外 → 保存される", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ memoryLabel: "CREATE" })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
  });

  it("shouldRemember:false → 保存されない", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ shouldRemember: false })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("shouldRemember:true でも memoryLabelがIGNORE → 保存されない", async () => {
    const result: MemoryRetrieverResult = { candidates: [candidate({ memoryLabel: "IGNORE" })] };
    mockedInvokeModelJson.mockResolvedValueOnce(result);

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("candidatesが配列でない → 何も保存しない", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: "not-an-array" } as never);

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("fallback（invokeModelJsonが第3引数をそのまま返す） → 何も保存しない", async () => {
    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).not.toHaveBeenCalled();
  });

  it("saveMemoryのitemにmemory_id・eventSummary・importance・tagsなどが入る", async () => {
    const c = candidate({
      eventSummary: "文化祭の準備を手伝った",
      importance: 77,
      tags: ["文化祭", "手伝い"],
    });
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: [c] });

    await runMemoryRetriever(process1Req({ characterId: "char-xyz" }));

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

describe("emotionValence（気分一致の記憶、D-040 フェーズ13a）", () => {
  it.each(["positive", "negative", "neutral"] as const)(
    "emotionValence:%sは、そのままsaveMemoryのitemに保存される",
    async (value) => {
      const c = candidate({ emotionValence: value } as Partial<MemoryCandidate>);
      mockedInvokeModelJson.mockResolvedValueOnce({ candidates: [c] });

      await runMemoryRetriever(process1Req());

      expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
      const item = mockedSaveMemory.mock.calls[0][0];
      expect(item.emotionValence).toBe(value);
    }
  );

  it("emotionValenceが省略されている → itemにemotionValenceが付かない", async () => {
    const c = candidate();
    delete (c as Partial<MemoryCandidate & { memoryLabel: string }>).emotionValence;
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: [c] });

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
    const item = mockedSaveMemory.mock.calls[0][0];
    expect("emotionValence" in item).toBe(false);
  });

  it("emotionValenceが不正な値 → itemにemotionValenceが付かない", async () => {
    const c = candidate({ emotionValence: "とても嬉しい" } as unknown as Partial<MemoryCandidate>);
    mockedInvokeModelJson.mockResolvedValueOnce({ candidates: [c] });

    await runMemoryRetriever(process1Req());

    expect(mockedSaveMemory).toHaveBeenCalledTimes(1);
    const item = mockedSaveMemory.mock.calls[0][0];
    expect("emotionValence" in item).toBe(false);
  });
});

describe("getRelevantMemoriesの呼び出し条件", () => {
  it("queryText・topK:20・minImportance:10で呼ばれる", async () => {
    await runMemoryRetriever(process1Req());

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
  // というキャストで参照している。プロンプト（memoryRetriever.fixed.mustache）はモデルに
  // memoryLabel を出力させる指示をしているため実行時には動作するが、型定義上は
  // MemoryCandidate に memoryLabel が存在せず、型チェックだけでは保存フィルタの実際の
  // 条件（IGNORE 除外）を追跡できない。
  it.todo(
    "MemoryCandidate型にmemoryLabelを追加する対応は本フェーズの対象外（src/を変更しないため）。型定義を実装に合わせるかどうかは別途検討"
  );
});
