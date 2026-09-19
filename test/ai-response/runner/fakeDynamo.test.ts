import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { createFakeDynamo, selectWritesForCharacter, type FakeDynamo } from "./fakeDynamo.js";
import type * as DynamoModule from "../../../src/lib/dynamo.js";
import type { AbsenceRecord, CharacterMemoryItem, ConversationLogItem, Mood, Perception } from "../../../src/types.js";

let dynamoModule: typeof DynamoModule;
let fake: FakeDynamo;

function mood(overrides: Partial<Mood> = {}): Mood {
  return { joy: 10, anxiety: 20, angry: 30, fatigue: 40, confidence: 50, loneliness: 60, ...overrides };
}

function perception(overrides: Partial<Perception> = {}): Perception {
  return { trust: 11, affection: 21, respect: 31, fear: 41, dependence: 51, familiarity: 61, ...overrides };
}

function absenceRecordInput(overrides: Partial<Omit<AbsenceRecord, "event_id" | "characterId">> = {}) {
  return {
    createdAt: "2026-01-14T00:00:00.000Z",
    startDatetime: "2026-01-13T21:00:00.000Z",
    endDatetime: "2026-01-14T00:00:00.000Z",
    events: [{ kind: "daily", summary: "学校に行った", detail: "友達と昼ご飯を食べた" }],
    actions: [
      { startDatetime: "2026-01-13T21:00:00.000Z", endDatetime: "2026-01-13T23:00:00.000Z", action: "登校・授業", memo: "" },
    ],
    threads: [{ id: "thread-1", topic: "来週テストがある", status: "open" as const, openedAt: "2026-01-13T21:00:00.000Z" }],
    ...overrides,
  };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  // conversationLogs/characterMemory/events の3テーブルが同じ空文字にならないよう、
  // 一意なテーブル名を明示的に設定してから dynamo.ts を読み込む。
  vi.stubEnv("CONVERSATION_LOGS_TABLE", "test-conversation-logs");
  vi.stubEnv("CHARACTER_MEMORY_TABLE", "test-character-memory");
  vi.stubEnv("EVENTS_TABLE", "test-events");
  vi.resetModules();

  dynamoModule = await import("../../../src/lib/dynamo.js");
  fake = createFakeDynamo();
  fake.install(dynamoModule);
});

afterEach(() => {
  fake.uninstall();
});

describe("感情・関係値", () => {
  it("seed した mood/perception を getCharacterState で読める", async () => {
    fake.seed("char-1", { mood: mood({ joy: 99 }), perception: perception({ trust: 88 }) });

    const result = await dynamoModule.getCharacterState("char-1");

    expect(result.mood.joy).toBe(99);
    expect(result.perception.trust).toBe(88);
  });

  it("mood/perception を省略 → getCharacterState は既定値を返す", async () => {
    fake.seed("char-1", {});

    const result = await dynamoModule.getCharacterState("char-1");

    expect(result.mood).toEqual(dynamoModule.DEFAULT_MOOD);
    expect(result.perception).toEqual(dynamoModule.DEFAULT_PERCEPTION);
  });

  it("saveCharacterState で書き込みが記録され、読み直せる", async () => {
    await dynamoModule.saveCharacterState("char-1", mood({ joy: 5 }), perception({ trust: 6 }));

    const result = await dynamoModule.getCharacterState("char-1");
    expect(result.mood.joy).toBe(5);
    expect(result.perception.trust).toBe(6);

    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ table: "characterMemory", operation: "put" });
  });
});

describe("重要記憶", () => {
  it("seed した重要記憶を getRelevantMemories で読める", async () => {
    const memories: Array<Omit<CharacterMemoryItem, "memory_id">> = [
      { index: "mem-1", eventSummary: "テスト前日", importance: 80, updatedAt: "2026-01-14T00:00:00.000Z", tags: ["テスト"] },
      { index: "mem-2", eventSummary: "映画の約束", importance: 60, updatedAt: "2026-01-14T00:00:00.000Z", tags: ["映画"] },
    ];
    fake.seed("char-1", { memories });

    const result = await dynamoModule.getRelevantMemories("char-1");

    expect(result.map((m) => m.index).sort()).toEqual(["mem-1", "mem-2"]);
  });

  it("saveMemory で書き込みが記録される", async () => {
    await dynamoModule.saveMemory({
      memory_id: "char-1",
      index: "mem-x",
      eventSummary: "保存テスト",
      importance: 70,
      updatedAt: "2026-01-14T00:00:00.000Z",
    });

    const result = await dynamoModule.getRelevantMemories("char-1");
    expect(result.map((m) => m.index)).toEqual(["mem-x"]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].table).toBe("characterMemory");
  });
});

describe("会話ログ", () => {
  it("seed した会話ログを getRecentLogs で古い順に読める", async () => {
    const conversationLogs: Array<Omit<ConversationLogItem, "conversation_id">> = [
      { index: "2026-01-14T00:00:00.000Z", role: "user", content: "1", memoryRetrieverJudgedFlag: 0 },
      { index: "2026-01-14T00:01:00.000Z", role: "assistant", content: "2", memoryRetrieverJudgedFlag: 0 },
      { index: "2026-01-14T00:02:00.000Z", role: "user", content: "3", memoryRetrieverJudgedFlag: 0 },
    ];
    fake.seed("char-1", { conversationLogs });

    const result = await dynamoModule.getRecentLogs("char-1", 10);

    expect(result.map((l) => l.content)).toEqual(["1", "2", "3"]);
  });

  it("getLogsForMemoryJudge で直近 turns*2 件を取得できる", async () => {
    const conversationLogs: Array<Omit<ConversationLogItem, "conversation_id">> = Array.from({ length: 12 }, (_, i) => ({
      index: `2026-01-14T00:${String(i).padStart(2, "0")}:00.000Z`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg-${i}`,
      memoryRetrieverJudgedFlag: 0,
    }));
    fake.seed("char-1", { conversationLogs });

    const result = await dynamoModule.getLogsForMemoryJudge("char-1", 5);

    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("msg-2");
    expect(result[9].content).toBe("msg-11");
  });

  it("saveConversationLog で書き込みが記録される", async () => {
    await dynamoModule.saveConversationLog("char-1", "user", "こんにちは");

    const result = await dynamoModule.getRecentLogs("char-1", 10);
    expect(result.map((l) => l.content)).toEqual(["こんにちは"]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ table: "conversationLogs", operation: "put" });
  });

  it("markLogsAsJudged で更新が記録され、読み直すとフラグが立っている", async () => {
    const conversationLogs: Array<Omit<ConversationLogItem, "conversation_id">> = [
      { index: "2026-01-14T00:00:00.000Z", role: "user", content: "1", memoryRetrieverJudgedFlag: 0 },
      { index: "2026-01-14T00:01:00.000Z", role: "assistant", content: "2", memoryRetrieverJudgedFlag: 0 },
    ];
    fake.seed("char-1", { conversationLogs });

    await dynamoModule.markLogsAsJudged("char-1", ["2026-01-14T00:00:00.000Z", "2026-01-14T00:01:00.000Z"]);

    const result = await dynamoModule.getRecentLogs("char-1", 10);
    expect(result.every((l) => l.memoryRetrieverJudgedFlag === 1)).toBe(true);
    expect(fake.writes.filter((w) => w.operation === "update")).toHaveLength(2);
  });
});

describe("不在期間の記録", () => {
  it("seed した不在期間の記録の最後の1件が getLatestAbsenceRecord で読める", async () => {
    fake.seed("char-1", {
      absenceRecords: [
        absenceRecordInput({ createdAt: "2026-01-13T00:00:00.000Z" }),
        absenceRecordInput({ createdAt: "2026-01-14T00:00:00.000Z" }),
        absenceRecordInput({ createdAt: "2026-01-15T00:00:00.000Z" }),
      ],
    });

    const latest = await dynamoModule.getLatestAbsenceRecord("char-1");

    expect(latest?.createdAt).toBe("2026-01-15T00:00:00.000Z");
    expect(latest?.characterId).toBe("char-1");
  });

  it("getRecentAbsenceRecords は新しい順に返す", async () => {
    fake.seed("char-1", {
      absenceRecords: [
        absenceRecordInput({ createdAt: "2026-01-13T00:00:00.000Z" }),
        absenceRecordInput({ createdAt: "2026-01-14T00:00:00.000Z" }),
        absenceRecordInput({ createdAt: "2026-01-15T00:00:00.000Z" }),
      ],
    });

    const recent = await dynamoModule.getRecentAbsenceRecords("char-1", 2);

    expect(recent.map((r) => r.createdAt)).toEqual(["2026-01-15T00:00:00.000Z", "2026-01-14T00:00:00.000Z"]);
  });

  it("saveAbsenceRecord（TransactWrite）で events・characterMemory の2件が記録され、読み直せる", async () => {
    const record: AbsenceRecord = { ...absenceRecordInput(), event_id: "event-1", characterId: "char-1" };

    await dynamoModule.saveAbsenceRecord(record);

    expect(fake.writes).toHaveLength(2);
    expect(fake.writes.map((w) => w.table).sort()).toEqual(["characterMemory", "events"]);

    const latest = await dynamoModule.getLatestAbsenceRecord("char-1");
    expect(latest).toEqual(record);

    const recent = await dynamoModule.getRecentAbsenceRecords("char-1", 5);
    expect(recent).toEqual([record]);
  });
});

describe("selectWritesForCharacter", () => {
  it("characterId/conversation_id/memory_id で自分の書き込みだけに絞り込める", async () => {
    await dynamoModule.saveConversationLog("char-a", "user", "a");
    await dynamoModule.saveConversationLog("char-b", "user", "b");
    await dynamoModule.saveCharacterState("char-a", mood(), perception());

    const forA = selectWritesForCharacter(fake.writes, "char-a");
    const forB = selectWritesForCharacter(fake.writes, "char-b");

    expect(forA).toHaveLength(2);
    expect(forB).toHaveLength(1);
  });
});

describe("未対応のコマンド・式", () => {
  it("未対応のコマンド（ScanCommand）は例外を投げる", async () => {
    await expect(
      dynamoModule.dynamo.send(new ScanCommand({ TableName: "test-conversation-logs" }) as never)
    ).rejects.toThrow(/unsupported command/);
  });

  it("2条件の KeyConditionExpression は例外を投げる", async () => {
    await expect(
      dynamoModule.dynamo.send(
        new QueryCommand({
          TableName: "test-conversation-logs",
          KeyConditionExpression: "conversation_id = :cid AND #idx = :idx",
          ExpressionAttributeNames: { "#idx": "index" },
          ExpressionAttributeValues: { ":cid": "char-1", ":idx": "x" },
        }) as never
      )
    ).rejects.toThrow(/unsupported.*KeyConditionExpression/);
  });

  it("SET 以外の UpdateExpression は例外を投げる", async () => {
    await expect(
      dynamoModule.dynamo.send(
        new UpdateCommand({
          TableName: "test-conversation-logs",
          Key: { conversation_id: "char-1", index: "idx" },
          UpdateExpression: "REMOVE memoryRetrieverJudgedFlag",
        }) as never
      )
    ).rejects.toThrow(/unsupported UpdateExpression/);
  });
});
