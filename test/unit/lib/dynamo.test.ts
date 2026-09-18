import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  QueryCommand,
  UpdateCommand,
  PutCommand,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  dynamo,
  getRelevantMemories,
  getCharacterState,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
  saveConversationLog,
  getRecentLogs,
  markLogsAsJudged,
  saveAbsenceRecord,
  getLatestAbsenceRecord,
  getRecentAbsenceRecords,
  LATEST_ABSENCE_RECORD_INDEX_KEY,
  CHARACTER_MEMORY_TABLE,
  EVENTS_TABLE,
} from "../../../src/lib/dynamo.js";
import type {
  AbsenceRecord,
  CharacterMemoryItem,
  CharacterStateItem,
  ConversationLogItem,
  LatestAbsenceRecordItem,
} from "../../../src/types.js";

function memory(overrides: Partial<CharacterMemoryItem>): CharacterMemoryItem {
  return {
    memory_id: "char-1",
    index: "mem-1",
    importance: 50,
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-01-15T00:00:00.000Z",
    startDatetime: "2026-01-14T21:00:00.000Z",
    endDatetime: "2026-01-15T00:00:00.000Z",
    events: [{ kind: "daily", summary: "学校に行った", detail: "友達と昼ご飯を食べた" }],
    actions: [
      {
        startDatetime: "2026-01-14T21:00:00.000Z",
        endDatetime: "2026-01-14T23:00:00.000Z",
        action: "登校・授業",
        memo: "",
      },
    ],
    threads: [{ id: "thread-1", topic: "来週テストがある", status: "open", openedAt: "2026-01-14T21:00:00.000Z" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getRelevantMemories", () => {
  const NOW = new Date("2026-01-15T00:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("index: 'state' のレコードは除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "state", importance: 100 }),
        memory({ index: "mem-1", importance: 50 }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe("mem-1");
  });

  it("index: 'absence-latest' のレコードは除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: LATEST_ABSENCE_RECORD_INDEX_KEY, importance: 100 }),
        memory({ index: "mem-1", importance: 50 }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe("mem-1");
  });

  it("minImportance未満（既定20）は除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "mem-low", importance: 19 }),
        memory({ index: "mem-ok", importance: 20 }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result.map((m) => m.index)).toEqual(["mem-ok"]);
  });

  it("minImportanceをオプション指定 → その値未満が除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "mem-low", importance: 40 }),
        memory({ index: "mem-ok", importance: 60 }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1", { minImportance: 50 });

    expect(result.map((m) => m.index)).toEqual(["mem-ok"]);
  });

  it("重要度が同じなら新しいほうが上位に来る", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "old", importance: 50, updatedAt: "2026-01-01T00:00:00.000Z" }),
        memory({ index: "new", importance: 50, updatedAt: "2026-01-14T00:00:00.000Z" }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result.map((m) => m.index)).toEqual(["new", "old"]);
  });

  it("古くても重要度が十分高ければ上位に来る（半減期14日）", async () => {
    // A: importance=100、28日前（半減期2回分）→ score = 100 * 0.25 = 25
    // B: importance=20、0日前 → score = 20 * 1 = 20
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "old-important", importance: 100, updatedAt: "2025-12-18T00:00:00.000Z" }),
        memory({ index: "new-low", importance: 20, updatedAt: "2026-01-15T00:00:00.000Z" }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result.map((m) => m.index)).toEqual(["old-important", "new-low"]);
  });

  it("queryTextにタグが含まれると順位が上がる", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "no-tag", importance: 50, updatedAt: "2026-01-15T00:00:00.000Z", tags: [] }),
        memory({
          index: "tag-match",
          importance: 50,
          updatedAt: "2026-01-15T00:00:00.000Z",
          tags: ["配信"],
        }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1", { queryText: "今日の配信どうだった？" });

    expect(result.map((m) => m.index)).toEqual(["tag-match", "no-tag"]);
  });

  it("queryText未指定ならタグは無視される（同点は元の順序を維持）", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: "first", importance: 50, updatedAt: "2026-01-15T00:00:00.000Z", tags: [] }),
        memory({
          index: "second",
          importance: 50,
          updatedAt: "2026-01-15T00:00:00.000Z",
          tags: ["配信"],
        }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result.map((m) => m.index)).toEqual(["first", "second"]);
  });

  it("topKは既定8件に絞られる", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      memory({ index: `mem-${i}`, importance: 100 - i, updatedAt: "2026-01-15T00:00:00.000Z" })
    );
    vi.spyOn(dynamo, "send").mockResolvedValue({ Items: items } as never);

    const result = await getRelevantMemories("char-1");

    expect(result).toHaveLength(8);
    expect(result.map((m) => m.index)).toEqual([
      "mem-0",
      "mem-1",
      "mem-2",
      "mem-3",
      "mem-4",
      "mem-5",
      "mem-6",
      "mem-7",
    ]);
  });

  it("topKをオプション指定 → その件数に絞られる", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      memory({ index: `mem-${i}`, importance: 100 - i, updatedAt: "2026-01-15T00:00:00.000Z" })
    );
    vi.spyOn(dynamo, "send").mockResolvedValue({ Items: items } as never);

    const result = await getRelevantMemories("char-1", { topK: 3 });

    expect(result.map((m) => m.index)).toEqual(["mem-0", "mem-1", "mem-2"]);
  });

  it("QueryのKeyConditionExpressionの値にcharacterIdが渡っている", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    await getRelevantMemories("char-xyz");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as QueryCommand;
    expect(command.input.KeyConditionExpression).toBe("memory_id = :mid");
    expect(command.input.ExpressionAttributeValues).toEqual({ ":mid": "char-xyz" });
  });
});

describe("getCharacterState", () => {
  it("Itemなし → DEFAULT_MOOD/DEFAULT_PERCEPTIONのコピーを返す", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    const result = await getCharacterState("char-1");

    expect(result.mood).toEqual(DEFAULT_MOOD);
    expect(result.perception).toEqual(DEFAULT_PERCEPTION);

    // 返り値を変更しても export の既定値が変わらないこと
    result.mood.joy = 999;
    result.perception.trust = 999;
    expect(DEFAULT_MOOD.joy).not.toBe(999);
    expect(DEFAULT_PERCEPTION.trust).not.toBe(999);
  });

  it("Itemあり → その値を返す", async () => {
    const item: CharacterStateItem = {
      memory_id: "char-1",
      index: "state",
      mood: { joy: 1, anxiety: 2, angry: 3, fatigue: 4, confidence: 5, loneliness: 6 },
      perception: { trust: 7, affection: 8, respect: 9, fear: 10, dependence: 11, familiarity: 12 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getCharacterState("char-1");

    expect(result.mood).toEqual(item.mood);
    expect(result.perception).toEqual(item.perception);
  });
});

describe("extractTableName", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("ARN形式の環境変数 → テーブル名部分だけになる", async () => {
    vi.stubEnv(
      "CONVERSATION_LOGS_TABLE",
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/foo"
    );
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.CONVERSATION_LOGS_TABLE).toBe("foo");
  });

  it("ARNでないテーブル名 → そのまま", async () => {
    vi.stubEnv("CONVERSATION_LOGS_TABLE", "plain-table-name");
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.CONVERSATION_LOGS_TABLE).toBe("plain-table-name");
  });

  it("未設定 → 空文字", async () => {
    vi.stubEnv("CHARACTER_MEMORY_TABLE", undefined);
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.CHARACTER_MEMORY_TABLE).toBe("");
  });

  it("EVENTS_TABLE未設定 → 既定値 'events'", async () => {
    vi.stubEnv("EVENTS_TABLE", undefined);
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.EVENTS_TABLE).toBe("events");
  });
});

describe("saveConversationLog", () => {
  it("呼び出す → PutCommandにconversation_id・role・content・memoryRetrieverJudgedFlagが入っている", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);

    await saveConversationLog("char-1", "user", "こんにちは");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as PutCommand;
    const item = command.input.Item as ConversationLogItem;
    expect(item.conversation_id).toBe("char-1");
    expect(item.role).toBe("user");
    expect(item.content).toBe("こんにちは");
    expect(item.memoryRetrieverJudgedFlag).toBe(0);
    expect(typeof item.index).toBe("string");
  });
});

describe("getRecentLogs", () => {
  it("降順で取得した結果を古い順に並べ替えて返す", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        { conversation_id: "char-1", index: "3", role: "assistant", content: "c" },
        { conversation_id: "char-1", index: "2", role: "user", content: "b" },
        { conversation_id: "char-1", index: "1", role: "assistant", content: "a" },
      ],
    } as never);

    const result = await getRecentLogs("char-1");

    expect(result.map((l) => l.index)).toEqual(["1", "2", "3"]);
  });
});

describe("markLogsAsJudged", () => {
  it("複数のindexを渡す → その件数分UpdateCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);

    await markLogsAsJudged("char-1", ["idx-1", "idx-2"]);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const commands = sendSpy.mock.calls.map((call) => call[0] as UpdateCommand);
    expect(commands.map((c) => c.input.Key)).toEqual([
      { conversation_id: "char-1", index: "idx-1" },
      { conversation_id: "char-1", index: "idx-2" },
    ]);
  });
});

describe("saveAbsenceRecord", () => {
  it("呼び出す → TransactWriteCommandでイベントテーブルと最新の記録を同時に保存する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);
    const record = absenceRecord();

    await saveAbsenceRecord(record);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as TransactWriteCommand;
    const items = command.input.TransactItems ?? [];
    expect(items).toHaveLength(2);

    expect(items[0].Put?.TableName).toBe(EVENTS_TABLE);
    expect(items[0].Put?.Item).toEqual(record);

    expect(items[1].Put?.TableName).toBe(CHARACTER_MEMORY_TABLE);
    const latestItem = items[1].Put?.Item as LatestAbsenceRecordItem;
    expect(latestItem.memory_id).toBe(record.characterId);
    expect(latestItem.index).toBe(LATEST_ABSENCE_RECORD_INDEX_KEY);
    expect(latestItem.record).toEqual(record);
    expect(typeof latestItem.updatedAt).toBe("string");
  });
});

describe("getLatestAbsenceRecord", () => {
  it("呼び出す → ConsistentRead:trueとKeyでGetCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    await getLatestAbsenceRecord("char-1");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as GetCommand;
    expect(command.input.TableName).toBe(CHARACTER_MEMORY_TABLE);
    expect(command.input.Key).toEqual({
      memory_id: "char-1",
      index: LATEST_ABSENCE_RECORD_INDEX_KEY,
    });
    expect(command.input.ConsistentRead).toBe(true);
  });

  it("項目あり（現行形式） → recordを返す", async () => {
    const record = absenceRecord();
    const item: LatestAbsenceRecordItem = {
      memory_id: "char-1",
      index: LATEST_ABSENCE_RECORD_INDEX_KEY,
      record,
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getLatestAbsenceRecord("char-1");

    expect(result).toEqual(record);
  });

  it("項目なし → null", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    const result = await getLatestAbsenceRecord("char-1");

    expect(result).toBeNull();
  });

  it("項目はあるが形式が不正（旧形式のevents） → null", async () => {
    const item = {
      memory_id: "char-1",
      index: LATEST_ABSENCE_RECORD_INDEX_KEY,
      record: {
        event_id: "event-1",
        characterId: "char-1",
        startDatetime: "2026-01-14T21:00:00.000Z",
        endDatetime: "2026-01-15T00:00:00.000Z",
        elapsed: "3時間",
        events: ["学校に行った"],
        createdAt: "2026-01-15T00:00:00.000Z",
      },
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getLatestAbsenceRecord("char-1");

    expect(result).toBeNull();
  });
});

describe("getRecentAbsenceRecords", () => {
  it("呼び出す → GSI名・KeyConditionExpression・ScanIndexForward:falseでQueryCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    await getRecentAbsenceRecords("char-1", 3);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as QueryCommand;
    expect(command.input.TableName).toBe(EVENTS_TABLE);
    expect(command.input.IndexName).toBe("characterId-index");
    expect(command.input.KeyConditionExpression).toBe("characterId = :cid");
    expect(command.input.ExpressionAttributeValues).toEqual({ ":cid": "char-1" });
    expect(command.input.ScanIndexForward).toBe(false);
    expect(command.input.Limit).toBe(3);
  });

  it("旧形式の項目を読み飛ばして新形式だけ返す", async () => {
    const valid = absenceRecord({ event_id: "event-valid" });
    const legacy = {
      event_id: "event-legacy",
      characterId: "char-1",
      startDatetime: "2026-01-13T00:00:00.000Z",
      endDatetime: "2026-01-13T03:00:00.000Z",
      elapsed: "3時間",
      events: ["旧形式の出来事"],
      createdAt: "2026-01-13T03:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [valid, legacy] } as never);

    const result = await getRecentAbsenceRecords("char-1", 5);

    expect(result).toEqual([valid]);
  });

  it("1ページ目で読み飛ばして足りないとき → ExclusiveStartKeyで次のページを読む", async () => {
    const legacy = {
      event_id: "event-legacy",
      characterId: "char-1",
      startDatetime: "2026-01-13T00:00:00.000Z",
      endDatetime: "2026-01-13T03:00:00.000Z",
      elapsed: "3時間",
      events: ["旧形式の出来事"],
      createdAt: "2026-01-13T03:00:00.000Z",
    };
    const valid = absenceRecord({ event_id: "event-valid" });
    const lastEvaluatedKey = { event_id: "event-legacy" };

    const sendSpy = vi
      .spyOn(dynamo, "send")
      .mockResolvedValueOnce({ Items: [legacy], LastEvaluatedKey: lastEvaluatedKey } as never)
      .mockResolvedValueOnce({ Items: [valid] } as never);

    const result = await getRecentAbsenceRecords("char-1", 1);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const secondCommand = sendSpy.mock.calls[1][0] as QueryCommand;
    expect(secondCommand.input.ExclusiveStartKey).toEqual(lastEvaluatedKey);
    expect(result).toEqual([valid]);
  });

  it("limit件集まったら以降のページは読まない", async () => {
    const first = absenceRecord({ event_id: "event-1" });
    const second = absenceRecord({ event_id: "event-2" });
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [first, second],
      LastEvaluatedKey: { event_id: "event-2" },
    } as never);

    const result = await getRecentAbsenceRecords("char-1", 2);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([first, second]);
  });

  it("LastEvaluatedKeyが無ければ次のページを読まずに終える", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    const result = await getRecentAbsenceRecords("char-1", 5);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it("読み飛ばしが続いて足りない場合でも最大ページ数で打ち切る", async () => {
    const legacy = {
      event_id: "event-legacy",
      characterId: "char-1",
      startDatetime: "2026-01-13T00:00:00.000Z",
      endDatetime: "2026-01-13T03:00:00.000Z",
      elapsed: "3時間",
      events: ["旧形式の出来事"],
      createdAt: "2026-01-13T03:00:00.000Z",
    };
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [legacy],
      LastEvaluatedKey: { event_id: "event-legacy" },
    } as never);

    const result = await getRecentAbsenceRecords("char-1", 5);

    expect(sendSpy).toHaveBeenCalledTimes(5);
    expect(result).toEqual([]);
  });

  it("limitが0以下 → DynamoDBを呼ばずに空配列を返す", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    const result = await getRecentAbsenceRecords("char-1", 0);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
