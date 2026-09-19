// -------------------------------------------------------
// メモリ上の偽の DynamoDB
//
// src/lib/dynamo.ts の `dynamo`（DynamoDBDocumentClient）の send を差し替え、
// dynamo.ts が実際に使うコマンドと式だけをメモリ上で再現する。本物の DynamoDB
// には絶対に接続しない（想定外のコマンド・式は例外にする）。
//
// 複数のシナリオ実行（同じモデル内の --concurrency）が同時に dynamo.send を
// 使うため、install() は実行のまとまり（同じモデルでの一連の実行）につき
// 一度だけ呼ぶ。以降は実行ごとに異なる characterId で seed() してから
// run* を呼ぶ（3テーブルとも characterId/conversation_id/memory_id が
// パーティションキーのため、characterId が実行ごとに一意であれば
// データは自然に分離される）。JavaScript はシングルスレッドなので、
// 複数の実行の non-blocking な呼び出しが this.items 配列を同時に
// 書き換えても壊れない。
//
// writes は「install してからの全実行分」をまとめて持つ。1回の実行分だけを
// 取り出すには selectWritesForCharacter(fake.writes, characterId) を使う
// （各書き込みの item に conversation_id/memory_id/characterId のいずれかが
// 実際の値として入っているため、実行の前後関係に関わらず正しく絞り込める）。
// -------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// 型だけの import（実行時には出力されない）。dynamo.ts の値は実行時に
// 呼び出し元（execute.ts）が動的 import で読み込み、install() に渡す
// （env 設定前にこのファイルが dynamo.ts を静的 import して読み込んでしまわないようにするため）。
import type * as DynamoModule from "../../../src/lib/dynamo.js";
import type { AbsenceRecord, CharacterMemoryItem, ConversationLogItem } from "../../../src/types.js";
import type { DynamoWriteRecord, ScenarioState } from "./types.js";

type StoredItem = Record<string, unknown>;

// events テーブルの GSI 名（dynamo.ts の EVENTS_BY_CHARACTER_INDEX_NAME と同じ）
const EVENTS_BY_CHARACTER_INDEX_NAME = "characterId-index";

// -------------------------------------------------------
// 単純なメモリ上のテーブル（パーティションキー＋任意のソートキー）
// -------------------------------------------------------

class FakeTable {
  private items: StoredItem[] = [];

  constructor(
    private readonly pkAttr: string,
    private readonly skAttr?: string
  ) {}

  private matchesKey(item: StoredItem, key: StoredItem): boolean {
    if (item[this.pkAttr] !== key[this.pkAttr]) return false;
    if (this.skAttr && key[this.skAttr] !== undefined && item[this.skAttr] !== key[this.skAttr]) {
      return false;
    }
    return true;
  }

  get(key: StoredItem): StoredItem | undefined {
    return this.items.find((item) => this.matchesKey(item, key));
  }

  put(item: StoredItem): void {
    const index = this.items.findIndex((existing) => this.matchesKey(existing, item));
    if (index >= 0) {
      this.items[index] = item;
    } else {
      this.items.push(item);
    }
  }

  update(key: StoredItem, attr: string, value: unknown): void {
    const existing = this.get(key);
    if (existing) {
      existing[attr] = value;
    } else {
      this.put({ ...key, [attr]: value });
    }
  }

  all(): StoredItem[] {
    return this.items;
  }
}

interface QueryOptions {
  scanIndexForward?: boolean;
  limit?: number;
  exclusiveStartKey?: StoredItem;
}

interface QueryResultPage {
  items: StoredItem[];
  lastEvaluatedKey?: StoredItem;
}

function queryByPartition(
  items: StoredItem[],
  pkAttr: string,
  pkValue: unknown,
  skAttr: string | undefined,
  options: QueryOptions
): QueryResultPage {
  let matched = items.filter((item) => item[pkAttr] === pkValue);

  if (skAttr) {
    matched = [...matched].sort((a, b) => {
      const av = String(a[skAttr] ?? "");
      const bv = String(b[skAttr] ?? "");
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }
  if (options.scanIndexForward === false) {
    matched = [...matched].reverse();
  }

  if (options.exclusiveStartKey) {
    const startKey = options.exclusiveStartKey;
    const startIndex = matched.findIndex((item) =>
      Object.entries(startKey).every(([k, v]) => item[k] === v)
    );
    if (startIndex >= 0) matched = matched.slice(startIndex + 1);
  }

  let lastEvaluatedKey: StoredItem | undefined;
  if (options.limit !== undefined && matched.length > options.limit) {
    const sliced = matched.slice(0, options.limit);
    const lastItem = sliced[sliced.length - 1];
    lastEvaluatedKey = { [pkAttr]: lastItem[pkAttr] };
    if (skAttr) lastEvaluatedKey[skAttr] = lastItem[skAttr];
    matched = sliced;
  }

  return { items: matched, lastEvaluatedKey };
}

/** dynamo.ts が使う「attr = :placeholder」の1条件だけの式を読み取る */
function parseSingleEqualityExpression(expression: string | undefined): {
  attr: string;
  placeholder: string;
} {
  const match = /^(\w+)\s*=\s*(:\w+)$/.exec((expression ?? "").trim());
  if (!match) {
    throw new Error(`fakeDynamo: unsupported KeyConditionExpression: ${JSON.stringify(expression)}`);
  }
  return { attr: match[1], placeholder: match[2] };
}

/** dynamo.ts の markLogsAsJudged が使う「SET attr = :placeholder」だけの式を読み取る */
function parseSetExpression(expression: string | undefined): { attr: string; placeholder: string } {
  const match = /^SET\s+(\w+)\s*=\s*(:\w+)$/.exec((expression ?? "").trim());
  if (!match) {
    throw new Error(`fakeDynamo: unsupported UpdateExpression: ${JSON.stringify(expression)}`);
  }
  return { attr: match[1], placeholder: match[2] };
}

type TableKey = "conversationLogs" | "characterMemory" | "events";

// -------------------------------------------------------
// 公開インターフェース
// -------------------------------------------------------

export interface FakeDynamo {
  /** install してからの全実行分の書き込み（selectWritesForCharacter で1回の実行分に絞り込む） */
  writes: DynamoWriteRecord[];
  /** characterId のデータを投入する（会話ログ・重要記憶・感情状態・不在期間の記録） */
  seed(characterId: string, state: ScenarioState): void;
  /** dynamo.ts の dynamo.send を差し替える（実行のまとまりにつき一度だけ呼ぶ） */
  install(dynamoModule: typeof DynamoModule): void;
  /** dynamo.send を元に戻す */
  uninstall(): void;
}

class FakeDynamoImpl implements FakeDynamo {
  writes: DynamoWriteRecord[] = [];

  private readonly conversationLogs = new FakeTable("conversation_id", "index");
  private readonly characterMemory = new FakeTable("memory_id", "index");
  private readonly events = new FakeTable("event_id");

  private dynamoModule?: typeof DynamoModule;
  private originalSend?: typeof DynamoModule.dynamo.send;

  install(dynamoModule: typeof DynamoModule): void {
    if (this.dynamoModule) {
      throw new Error("fakeDynamo: already installed (call uninstall() first)");
    }
    this.dynamoModule = dynamoModule;
    this.originalSend = dynamoModule.dynamo.send.bind(dynamoModule.dynamo);
    dynamoModule.dynamo.send = ((command: unknown) =>
      this.handle(command)) as unknown as typeof dynamoModule.dynamo.send;
  }

  uninstall(): void {
    if (this.dynamoModule && this.originalSend) {
      this.dynamoModule.dynamo.send = this.originalSend;
    }
    this.dynamoModule = undefined;
    this.originalSend = undefined;
  }

  seed(characterId: string, state: ScenarioState): void {
    const dynamoModule = this.requireInstalled();

    if (state.mood || state.perception) {
      this.characterMemory.put({
        memory_id: characterId,
        index: dynamoModule.STATE_INDEX_KEY,
        mood: state.mood ?? dynamoModule.DEFAULT_MOOD,
        perception: state.perception ?? dynamoModule.DEFAULT_PERCEPTION,
        updatedAt: new Date().toISOString(),
      });
    }

    if (state.relationship) {
      this.characterMemory.put({
        memory_id: characterId,
        index: dynamoModule.RELATIONSHIP_INDEX_KEY,
        ...state.relationship,
      });
    }

    for (const memory of state.memories ?? []) {
      const item: CharacterMemoryItem = { ...memory, memory_id: characterId };
      this.characterMemory.put(item as unknown as StoredItem);
    }

    for (const log of state.conversationLogs ?? []) {
      const item: ConversationLogItem = { ...log, conversation_id: characterId };
      this.conversationLogs.put(item as unknown as StoredItem);
    }

    let latest: AbsenceRecord | undefined;
    for (const partial of state.absenceRecords ?? []) {
      const record: AbsenceRecord = { ...partial, event_id: randomUUID(), characterId };
      this.events.put(record as unknown as StoredItem);
      latest = record;
    }
    if (latest) {
      this.characterMemory.put({
        memory_id: characterId,
        index: dynamoModule.LATEST_ABSENCE_RECORD_INDEX_KEY,
        record: latest,
        updatedAt: latest.createdAt,
      });
    }
  }

  private requireInstalled(): typeof DynamoModule {
    if (!this.dynamoModule) {
      throw new Error("fakeDynamo: not installed (call install() first)");
    }
    return this.dynamoModule;
  }

  private resolveTableKey(tableName: string | undefined): TableKey {
    const dynamoModule = this.requireInstalled();
    if (tableName === dynamoModule.CONVERSATION_LOGS_TABLE) return "conversationLogs";
    if (tableName === dynamoModule.CHARACTER_MEMORY_TABLE) return "characterMemory";
    if (tableName === dynamoModule.EVENTS_TABLE) return "events";
    throw new Error(`fakeDynamo: unknown table name: ${JSON.stringify(tableName)}`);
  }

  private tableFor(key: TableKey): FakeTable {
    if (key === "conversationLogs") return this.conversationLogs;
    if (key === "characterMemory") return this.characterMemory;
    return this.events;
  }

  private async handle(command: unknown): Promise<unknown> {
    if (command instanceof GetCommand) {
      const { TableName, Key } = command.input;
      const table = this.tableFor(this.resolveTableKey(TableName));
      return { Item: table.get((Key ?? {}) as StoredItem) };
    }

    if (command instanceof PutCommand) {
      const { TableName, Item } = command.input;
      const tableKey = this.resolveTableKey(TableName);
      const item = { ...(Item as StoredItem) };
      this.tableFor(tableKey).put(item);
      this.writes.push({ table: tableKey, operation: "put", item });
      return {};
    }

    if (command instanceof QueryCommand) {
      const {
        TableName,
        IndexName,
        KeyConditionExpression,
        ExpressionAttributeValues,
        ScanIndexForward,
        Limit,
        ExclusiveStartKey,
      } = command.input;
      const tableKey = this.resolveTableKey(TableName);
      const { attr: pkAttr, placeholder } = parseSingleEqualityExpression(KeyConditionExpression);
      const pkValue = (ExpressionAttributeValues ?? {})[placeholder];

      let skAttr: string;
      if (tableKey === "events") {
        if (IndexName !== EVENTS_BY_CHARACTER_INDEX_NAME) {
          throw new Error(
            `fakeDynamo: events table query requires IndexName=${EVENTS_BY_CHARACTER_INDEX_NAME} (got ${JSON.stringify(IndexName)})`
          );
        }
        skAttr = "createdAt";
      } else {
        skAttr = "index";
      }

      const { items, lastEvaluatedKey } = queryByPartition(
        this.tableFor(tableKey).all(),
        pkAttr,
        pkValue,
        skAttr,
        {
          scanIndexForward: ScanIndexForward,
          limit: Limit,
          exclusiveStartKey: ExclusiveStartKey as StoredItem | undefined,
        }
      );
      return { Items: items, LastEvaluatedKey: lastEvaluatedKey };
    }

    if (command instanceof UpdateCommand) {
      const { TableName, Key, UpdateExpression, ExpressionAttributeValues } = command.input;
      const tableKey = this.resolveTableKey(TableName);
      const { attr, placeholder } = parseSetExpression(UpdateExpression);
      const value = (ExpressionAttributeValues ?? {})[placeholder];
      this.tableFor(tableKey).update((Key ?? {}) as StoredItem, attr, value);
      this.writes.push({
        table: tableKey,
        operation: "update",
        item: { ...(Key as Record<string, unknown>), [attr]: value },
      });
      return {};
    }

    if (command instanceof TransactWriteCommand) {
      const transactItems = command.input.TransactItems ?? [];
      for (const transactItem of transactItems) {
        if (!transactItem.Put) {
          throw new Error("fakeDynamo: TransactWriteCommand only supports Put items");
        }
        const { TableName, Item } = transactItem.Put;
        const tableKey = this.resolveTableKey(TableName);
        const item = { ...(Item as StoredItem) };
        this.tableFor(tableKey).put(item);
        this.writes.push({ table: tableKey, operation: "put", item });
      }
      return {};
    }

    const commandName = (command as { constructor: { name: string } })?.constructor?.name ?? typeof command;
    throw new Error(`fakeDynamo: unsupported command: ${commandName}`);
  }
}

export function createFakeDynamo(): FakeDynamo {
  return new FakeDynamoImpl();
}

/**
 * writes（install してからの全実行分をまとめて持つ）から、指定した characterId に
 * 属する書き込みだけを取り出す。各書き込みの item に conversation_id/memory_id/characterId
 * のいずれかが実際の値として入っているため、実行の前後関係（concurrency による割り込み）に
 * 関わらず正しく絞り込める。
 */
export function selectWritesForCharacter(
  writes: DynamoWriteRecord[],
  characterId: string
): DynamoWriteRecord[] {
  return writes.filter((write) => {
    const item = write.item;
    return (
      item.conversation_id === characterId ||
      item.memory_id === characterId ||
      item.characterId === characterId
    );
  });
}
