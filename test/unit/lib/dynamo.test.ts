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
  saveConversationLog,
  getRecentLogs,
  markLogsAsJudged,
  saveAbsenceRecord,
  getLatestAbsenceRecord,
  getRecentAbsenceRecords,
  getRelationshipRecord,
  saveRelationshipRecord,
  getTesterCharacter,
  listTesterCharacters,
  createTesterCharacter,
  LATEST_ABSENCE_RECORD_INDEX_KEY,
  RELATIONSHIP_INDEX_KEY,
  RELATIONSHIP_MILESTONE_MEMORY_TYPE,
  CHARACTER_MEMORY_TABLE,
  EVENTS_TABLE,
  TESTER_CHARACTERS_TABLE,
} from "../../../src/lib/dynamo.js";
import type {
  AbsenceRecord,
  CharacterMemoryItem,
  ConversationLogItem,
  LatestAbsenceRecordItem,
  RelationshipRecord,
  TesterCharacter,
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

function testerCharacter(overrides: Partial<TesterCharacter> = {}): TesterCharacter {
  return {
    testerId: "tester-1",
    characterId: "char-1",
    packageId: "yui-modern-tokyo",
    label: "キャラクター1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function relationshipRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    firstMetAt: "2026-01-01T00:00:00.000Z",
    lastConversationAt: "2026-01-15T00:00:00.000Z",
    lastConversationDate: "2026-01-15",
    conversationCount: 12,
    conversationDays: 3,
    stageKey: "first",
    highestStageKey: "first",
    recoveryRemaining: 0,
    lastDemotedAt: null,
    updatedAt: "2026-01-15T00:00:00.000Z",
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

  it("index: 'relationship' のレコードは除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({ index: RELATIONSHIP_INDEX_KEY, importance: 100 }),
        memory({ index: "mem-1", importance: 50 }),
      ],
    } as never);

    const result = await getRelevantMemories("char-1");

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe("mem-1");
  });

  it("memoryType: 'relationship_milestone' の記憶は除外される", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({
      Items: [
        memory({
          index: "mem-milestone",
          importance: 100,
          memoryType: RELATIONSHIP_MILESTONE_MEMORY_TYPE,
        }),
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

  describe("moodPleasure（気分一致効果、D-040 フェーズ13a）", () => {
    it("気分が快でemotionValence:positiveの記憶のスコアが上がり順位が入れ替わる", async () => {
      vi.spyOn(dynamo, "send").mockResolvedValue({
        Items: [
          memory({
            index: "no-valence",
            importance: 65,
            emotionValence: undefined,
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
          memory({
            index: "positive",
            importance: 60,
            emotionValence: "positive",
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
        ],
      } as never);

      const result = await getRelevantMemories("char-1", { moodPleasure: 100 });

      expect(result.map((m) => m.index)).toEqual(["positive", "no-valence"]);
    });

    it("気分が不快でemotionValence:negativeの記憶のスコアが上がり順位が入れ替わる", async () => {
      vi.spyOn(dynamo, "send").mockResolvedValue({
        Items: [
          memory({
            index: "no-valence",
            importance: 65,
            emotionValence: undefined,
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
          memory({
            index: "negative",
            importance: 60,
            emotionValence: "negative",
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
        ],
      } as never);

      const result = await getRelevantMemories("char-1", { moodPleasure: -100 });

      expect(result.map((m) => m.index)).toEqual(["negative", "no-valence"]);
    });

    it("向きが逆・neutral・項目なしの記憶はボーナスがかからない（重要度の順のまま）", async () => {
      vi.spyOn(dynamo, "send").mockResolvedValue({
        Items: [
          memory({
            index: "opposite",
            importance: 70,
            emotionValence: "negative",
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
          memory({
            index: "neutral",
            importance: 60,
            emotionValence: "neutral",
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
          memory({
            index: "none",
            importance: 50,
            emotionValence: undefined,
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
        ],
      } as never);

      // moodPleasure は正（快）だが、opposite は negative なので一致しない
      const result = await getRelevantMemories("char-1", { moodPleasure: 100 });

      expect(result.map((m) => m.index)).toEqual(["opposite", "neutral", "none"]);
    });

    it("moodPleasureを未指定・0のどちらでも今までと同じ順位になる", async () => {
      const items = [
        memory({
          index: "no-valence",
          importance: 65,
          emotionValence: undefined,
          updatedAt: "2026-01-15T00:00:00.000Z",
        }),
        memory({
          index: "positive",
          importance: 60,
          emotionValence: "positive",
          updatedAt: "2026-01-15T00:00:00.000Z",
        }),
      ];
      vi.spyOn(dynamo, "send").mockResolvedValue({ Items: items } as never);

      const withoutOption = await getRelevantMemories("char-1");
      const withZero = await getRelevantMemories("char-1", { moodPleasure: 0 });

      expect(withoutOption.map((m) => m.index)).toEqual(["no-valence", "positive"]);
      expect(withZero.map((m) => m.index)).toEqual(["no-valence", "positive"]);
    });

    it("ボーナスの大きさがmoodPleasureの絶対値に比例する（弱い気分では順位が変わらず、強い気分では変わる）", async () => {
      vi.spyOn(dynamo, "send").mockResolvedValue({
        Items: [
          memory({
            index: "no-valence",
            importance: 75,
            emotionValence: undefined,
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
          memory({
            index: "positive",
            importance: 60,
            emotionValence: "positive",
            updatedAt: "2026-01-15T00:00:00.000Z",
          }),
        ],
      } as never);

      const weakMood = await getRelevantMemories("char-1", { moodPleasure: 50 });
      const strongMood = await getRelevantMemories("char-1", { moodPleasure: 100 });

      expect(weakMood.map((m) => m.index)).toEqual(["no-valence", "positive"]);
      expect(strongMood.map((m) => m.index)).toEqual(["positive", "no-valence"]);
    });
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

describe("getRelationshipRecord", () => {
  it("呼び出す → ConsistentRead:trueとKeyでGetCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    await getRelationshipRecord("char-1");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as GetCommand;
    expect(command.input.TableName).toBe(CHARACTER_MEMORY_TABLE);
    expect(command.input.Key).toEqual({
      memory_id: "char-1",
      index: RELATIONSHIP_INDEX_KEY,
    });
    expect(command.input.ConsistentRead).toBe(true);
  });

  it("項目なし → null", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    const result = await getRelationshipRecord("char-1");

    expect(result).toBeNull();
  });

  it("項目あり（現行形式） → recordを返す", async () => {
    const record = relationshipRecord();
    const item = { memory_id: "char-1", index: RELATIONSHIP_INDEX_KEY, ...record };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getRelationshipRecord("char-1");

    expect(result).toEqual(record);
  });

  it("項目はあるが形式が不正（必須項目が無い） → null", async () => {
    const item = {
      memory_id: "char-1",
      index: RELATIONSHIP_INDEX_KEY,
      // stageKey・highestStageKey等が無い壊れた形
      firstMetAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getRelationshipRecord("char-1");

    expect(result).toBeNull();
  });
});

describe("saveRelationshipRecord", () => {
  it("呼び出す → PutCommandにmemory_id・index・recordの中身が入っている", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);
    const record = relationshipRecord();

    await saveRelationshipRecord("char-1", record);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as PutCommand;
    expect(command.input.TableName).toBe(CHARACTER_MEMORY_TABLE);
    const item = command.input.Item as Record<string, unknown>;
    expect(item.memory_id).toBe("char-1");
    expect(item.index).toBe(RELATIONSHIP_INDEX_KEY);
    expect(item).toMatchObject(record);
  });

  it("保存した内容をgetRelationshipRecordで読むと同じ値になる（往復）", async () => {
    const record = relationshipRecord({ stageKey: "acquainted", conversationCount: 30 });
    let savedItem: Record<string, unknown> | undefined;
    vi.spyOn(dynamo, "send").mockImplementation(async (command) => {
      if (command instanceof PutCommand) {
        savedItem = command.input.Item as Record<string, unknown>;
        return {} as never;
      }
      if (command instanceof GetCommand) {
        return { Item: savedItem } as never;
      }
      throw new Error("unexpected command");
    });

    await saveRelationshipRecord("char-1", record);
    const result = await getRelationshipRecord("char-1");

    expect(result).toEqual(record);
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

  it("TESTER_CHARACTERS_TABLE未設定 → 既定値 'tester-characters'", async () => {
    vi.stubEnv("TESTER_CHARACTERS_TABLE", undefined);
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.TESTER_CHARACTERS_TABLE).toBe("tester-characters");
  });

  it("TESTER_CHARACTERS_TABLEがARN形式 → テーブル名部分だけになる", async () => {
    vi.stubEnv(
      "TESTER_CHARACTERS_TABLE",
      "arn:aws:dynamodb:ap-northeast-1:123456789012:table/tester-characters-stg"
    );
    vi.resetModules();

    const mod = await import("../../../src/lib/dynamo.js");

    expect(mod.TESTER_CHARACTERS_TABLE).toBe("tester-characters-stg");
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

describe("getTesterCharacter", () => {
  it("呼び出す → tester_id・character_idのKeyでGetCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    await getTesterCharacter("tester-1", "char-1");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as GetCommand;
    expect(command.input.TableName).toBe(TESTER_CHARACTERS_TABLE);
    expect(command.input.Key).toEqual({ tester_id: "tester-1", character_id: "char-1" });
  });

  it("項目なし → null", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    const result = await getTesterCharacter("tester-1", "char-1");

    expect(result).toBeNull();
  });

  it("項目あり → tester_id/character_idをtesterId/characterIdに変換して返す", async () => {
    const item = {
      tester_id: "tester-1",
      character_id: "char-1",
      packageId: "yui-modern-tokyo",
      label: "キャラクター1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getTesterCharacter("tester-1", "char-1");

    expect(result).toEqual(testerCharacter());
  });
});

describe("listTesterCharacters", () => {
  it("呼び出す → tester_idでQueryCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    await listTesterCharacters("tester-1");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as QueryCommand;
    expect(command.input.TableName).toBe(TESTER_CHARACTERS_TABLE);
    expect(command.input.KeyConditionExpression).toBe("tester_id = :tid");
    expect(command.input.ExpressionAttributeValues).toEqual({ ":tid": "tester-1" });
  });

  it("createdAtの古い順に並べ替えて返す", async () => {
    const items = [
      {
        tester_id: "tester-1",
        character_id: "char-new",
        packageId: "yui-modern-tokyo",
        label: "新しい方",
        createdAt: "2026-01-15T00:00:00.000Z",
      },
      {
        tester_id: "tester-1",
        character_id: "char-old",
        packageId: "yui-modern-tokyo",
        label: "古い方",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    vi.spyOn(dynamo, "send").mockResolvedValue({ Items: items } as never);

    const result = await listTesterCharacters("tester-1");

    expect(result.map((c) => c.characterId)).toEqual(["char-old", "char-new"]);
  });

  it("項目なし → 空配列", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Items: [] } as never);

    const result = await listTesterCharacters("tester-1");

    expect(result).toEqual([]);
  });
});

describe("createTesterCharacter", () => {
  it("呼び出す → 条件式付きPutCommandでtester_id/character_idを含む項目を保存する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);
    const record = testerCharacter();

    await createTesterCharacter(record);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as PutCommand;
    expect(command.input.TableName).toBe(TESTER_CHARACTERS_TABLE);
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(character_id)");
    expect(command.input.Item).toEqual({
      tester_id: "tester-1",
      character_id: "char-1",
      packageId: "yui-modern-tokyo",
      label: "キャラクター1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("保存した内容をgetTesterCharacterで読むと同じ値になる（往復）", async () => {
    const record = testerCharacter({ characterId: "char-2", label: "2つ目" });
    let savedItem: Record<string, unknown> | undefined;
    vi.spyOn(dynamo, "send").mockImplementation(async (command) => {
      if (command instanceof PutCommand) {
        savedItem = command.input.Item as Record<string, unknown>;
        return {} as never;
      }
      if (command instanceof GetCommand) {
        return { Item: savedItem } as never;
      }
      throw new Error("unexpected command");
    });

    await createTesterCharacter(record);
    const result = await getTesterCharacter("tester-1", "char-2");

    expect(result).toEqual(record);
  });

  it("条件式が満たされない場合、DynamoDBが投げる例外がそのまま伝播する", async () => {
    const error = new Error("ConditionalCheckFailedException");
    vi.spyOn(dynamo, "send").mockRejectedValue(error);

    await expect(createTesterCharacter(testerCharacter())).rejects.toThrow(
      "ConditionalCheckFailedException"
    );
  });
});
