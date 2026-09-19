import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  AbsenceEvent,
  AbsenceRecord,
  AbsenceThread,
  Action,
  CharacterMemoryItem,
  CharacterStateItem,
  ConversationLogItem,
  LatestAbsenceRecordItem,
  Mood,
  Perception,
} from "../types.js";

// -------------------------------------------------------
// クライアント
// -------------------------------------------------------

const raw = new DynamoDBClient({});
export const dynamo = DynamoDBDocumentClient.from(raw);

// -------------------------------------------------------
// 環境変数からテーブル名を解決
// -------------------------------------------------------

function extractTableName(arnOrName: string | undefined): string {
  if (!arnOrName) return "";
  if (arnOrName.startsWith("arn:")) return arnOrName.split("/").pop()!;
  return arnOrName;
}

export const CONVERSATION_LOGS_TABLE = extractTableName(
  process.env.CONVERSATION_LOGS_TABLE
);
export const CHARACTER_MEMORY_TABLE = extractTableName(
  process.env.CHARACTER_MEMORY_TABLE
);
export const EVENTS_TABLE = extractTableName(process.env.EVENTS_TABLE ?? "events");

// STATE レコードの固定ソートキー
export const STATE_INDEX_KEY = "state";
// 最新の不在期間の記録の固定ソートキー（D-019）
export const LATEST_ABSENCE_RECORD_INDEX_KEY = "absence-latest";

// -------------------------------------------------------
// デフォルト値
// -------------------------------------------------------

export const DEFAULT_MOOD: Mood = {
  joy: 35,
  anxiety: 62,
  angry: 20,
  fatigue: 48,
  confidence: 30,
  loneliness: 10,
};

export const DEFAULT_PERCEPTION: Perception = {
  trust: 72,
  affection: 55,
  respect: 80,
  fear: 12,
  dependence: 30,
  familiarity: 65,
};

// -------------------------------------------------------
// 会話ログ
// -------------------------------------------------------

/** 会話ログを 1 件保存する */
export async function saveConversationLog(
  characterId: string,
  role: "user" | "assistant",
  content: string,
  memoryRetrieverJudgedFlag = 0
): Promise<void> {
  const index = new Date().toISOString();
  const item: ConversationLogItem = {
    conversation_id: characterId,
    index,
    role,
    content,
    memoryRetrieverJudgedFlag,
  };
  await dynamo.send(new PutCommand({ TableName: CONVERSATION_LOGS_TABLE, Item: item }));
  console.log(`[saveLog] ${role} characterId=${characterId} index=${index}`);
}

/** 直近 N 件の会話ログを古い順で返す */
export async function getRecentLogs(
  characterId: string,
  limit = 10
): Promise<ConversationLogItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CONVERSATION_LOGS_TABLE,
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: { ":cid": characterId },
      ScanIndexForward: false,
      Limit: limit,
    })
  );
  const logs = ((result.Items ?? []) as ConversationLogItem[]).reverse();
  console.log(`[getRecentLogs] ${logs.length} logs for characterId=${characterId}`);
  return logs;
}

/**
 * 直近 N 往復（user + assistant セット）の会話ログを取得する。
 * memoryRetriever の5往復判定に使用。
 */
export async function getLogsForMemoryJudge(
  characterId: string,
  turns = 5
): Promise<ConversationLogItem[]> {
  // 1往復 = user + assistant の2件
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CONVERSATION_LOGS_TABLE,
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: { ":cid": characterId },
      ScanIndexForward: false,
      Limit: turns * 2,
    })
  );
  return ((result.Items ?? []) as ConversationLogItem[]).reverse();
}

/** 会話ログに memoryRetrieverJudgedFlag=1 を追記する */
export async function markLogsAsJudged(
  characterId: string,
  indexes: string[]
): Promise<void> {
  await Promise.all(
    indexes.map((index) =>
      dynamo.send(
        new UpdateCommand({
          TableName: CONVERSATION_LOGS_TABLE,
          Key: { conversation_id: characterId, index },
          UpdateExpression: "SET memoryRetrieverJudgedFlag = :v",
          ExpressionAttributeValues: { ":v": 1 },
        })
      )
    )
  );
  console.log(`[markLogsAsJudged] marked ${indexes.length} logs`);
}

// -------------------------------------------------------
// キャラクター感情・関係値
// -------------------------------------------------------

/** CHARACTER_MEMORY_TABLE から感情・関係値を取得する */
export async function getCharacterState(
  characterId: string
): Promise<{ mood: Mood; perception: Perception }> {
  const result = await dynamo.send(
    new GetCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      Key: { memory_id: characterId, index: STATE_INDEX_KEY },
    })
  );
  if (!result.Item) {
    console.log(`[getCharacterState] not found, using defaults characterId=${characterId}`);
    return { mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } };
  }
  const item = result.Item as CharacterStateItem;
  return {
    mood: item.mood ?? { ...DEFAULT_MOOD },
    perception: item.perception ?? { ...DEFAULT_PERCEPTION },
  };
}

/** CHARACTER_MEMORY_TABLE に感情・関係値を保存する */
export async function saveCharacterState(
  characterId: string,
  mood: Mood,
  perception: Perception
): Promise<void> {
  const item: CharacterStateItem = {
    memory_id: characterId,
    index: STATE_INDEX_KEY,
    mood,
    perception,
    updatedAt: new Date().toISOString(),
  };
  await dynamo.send(new PutCommand({ TableName: CHARACTER_MEMORY_TABLE, Item: item }));
  console.log(`[saveCharacterState] saved characterId=${characterId}`);
}

// -------------------------------------------------------
// キャラクター重要記憶
// -------------------------------------------------------

/** キャラクターの重要記憶一覧を取得する（全件。呼び出し元は基本 getRelevantMemories を使う） */
async function getMemories(characterId: string): Promise<CharacterMemoryItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      KeyConditionExpression: "memory_id = :mid",
      ExpressionAttributeValues: { ":mid": characterId },
    })
  );
  // 同じ memory_id に感情状態レコード（index="state"）・最新の不在期間の記録
  // （index="absence-latest"）が同居しているため除外する
  const memories = ((result.Items ?? []) as CharacterMemoryItem[]).filter(
    (item) => item.index !== STATE_INDEX_KEY && item.index !== LATEST_ABSENCE_RECORD_INDEX_KEY
  );
  console.log(`[getMemories] ${memories.length} memories for characterId=${characterId}`);
  return memories;
}

// 新しさ減衰の半減期（日数）: 重要度が高い記憶ほど、この減衰の影響を受けにくい
const MEMORY_RECENCY_HALF_LIFE_DAYS = 14;
// クエリ文の tags 一致1件あたりのスコア倍率ボーナス
const MEMORY_KEYWORD_MATCH_BONUS = 0.5;

export interface GetRelevantMemoriesOptions {
  /** 指定するとタグ一致によるスコアボーナスを加味する（プレイヤー発言など） */
  queryText?: string;
  /** 上位何件を返すか */
  topK?: number;
  /** この重要度未満の記憶は新しさに関係なく除外する */
  minImportance?: number;
}

function scoreMemory(
  memory: CharacterMemoryItem,
  queryText: string | undefined,
  now: number
): number {
  const importance = memory.importance ?? 0;
  const updatedAt = memory.updatedAt ? new Date(memory.updatedAt).getTime() : now;
  const daysSinceUpdated = Math.max(0, (now - updatedAt) / (1000 * 60 * 60 * 24));
  const recencyDecay = Math.pow(2, -daysSinceUpdated / MEMORY_RECENCY_HALF_LIFE_DAYS);

  let matchedTagCount = 0;
  if (queryText) {
    matchedTagCount = (memory.tags ?? []).filter(
      (tag) => tag && queryText.includes(tag)
    ).length;
  }

  return importance * recencyDecay * (1 + MEMORY_KEYWORD_MATCH_BONUS * matchedTagCount);
}

/**
 * キャラクターの重要記憶を「重要度 × 新しさ（＋クエリ文とのタグ一致）」でスコアリングし、
 * 上位 topK 件だけを返す。プロンプトへの全件埋め込みを避けるための絞り込み用途。
 */
export async function getRelevantMemories(
  characterId: string,
  options: GetRelevantMemoriesOptions = {}
): Promise<CharacterMemoryItem[]> {
  const { queryText, topK = 8, minImportance = 20 } = options;

  const memories = await getMemories(characterId);
  const now = Date.now();

  const relevant = memories
    .filter((m) => (m.importance ?? 0) >= minImportance)
    .map((m) => ({ memory: m, score: scoreMemory(m, queryText, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => r.memory);

  console.log(
    `[getRelevantMemories] ${relevant.length}/${memories.length} memories selected for characterId=${characterId} (topK=${topK}, minImportance=${minImportance}, hasQuery=${!!queryText})`
  );
  return relevant;
}

/** 重要記憶を 1 件保存する */
export async function saveMemory(item: CharacterMemoryItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: CHARACTER_MEMORY_TABLE, Item: item }));
  console.log(`[saveMemory] saved memory_id=${item.memory_id} index=${item.index}`);
}

// -------------------------------------------------------
// 不在期間の記録（D-015・D-019）
//
// 履歴はイベントテーブルに保存し、最新の1件はキャラクター記憶テーブルにも
// index="absence-latest" で保存する（感情状態の index="state" と同じ形）。
// 最新の記録は強い整合性の GetItem で読み、直近 N 件の履歴は GSI
// （characterId-index）の結果整合性のクエリで読む。
// -------------------------------------------------------

// events テーブルの GSI（characterId + createdAt の降順）の名前
const EVENTS_BY_CHARACTER_INDEX_NAME = "characterId-index";
// 直近の履歴を読むときにページを続ける最大回数（無限ループ防止）
const MAX_ABSENCE_RECORD_QUERY_PAGES = 5;

function isAbsenceEvent(value: unknown): value is AbsenceEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || typeof v.summary !== "string" || typeof v.detail !== "string") {
    return false;
  }
  if (v.threadId !== undefined && typeof v.threadId !== "string") return false;
  return true;
}

function isAbsenceAction(value: unknown): value is Action {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.startDatetime === "string" &&
    typeof v.endDatetime === "string" &&
    typeof v.action === "string" &&
    typeof v.memo === "string"
  );
}

function isAbsenceThread(value: unknown): value is AbsenceThread {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.topic === "string" &&
    typeof v.openedAt === "string" &&
    (v.status === "open" || v.status === "closed")
  );
}

/**
 * 値が現行形式の AbsenceRecord かどうかを判定する。
 * 旧形式（events が文字列配列、threads が無い等）は false になる。
 */
function isAbsenceRecord(value: unknown): value is AbsenceRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === "string" &&
    typeof v.characterId === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.startDatetime === "string" &&
    typeof v.endDatetime === "string" &&
    Array.isArray(v.events) &&
    v.events.every(isAbsenceEvent) &&
    Array.isArray(v.actions) &&
    v.actions.every(isAbsenceAction) &&
    Array.isArray(v.threads) &&
    v.threads.every(isAbsenceThread)
  );
}

/**
 * 不在期間の記録を保存する。イベントテーブルへの履歴の保存と、
 * キャラクター記憶テーブルへの最新の記録の保存を、トランザクションで同時に行う。
 */
export async function saveAbsenceRecord(record: AbsenceRecord): Promise<void> {
  const latestItem: LatestAbsenceRecordItem = {
    memory_id: record.characterId,
    index: LATEST_ABSENCE_RECORD_INDEX_KEY,
    record,
    updatedAt: new Date().toISOString(),
  };
  await dynamo.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: EVENTS_TABLE, Item: record } },
        { Put: { TableName: CHARACTER_MEMORY_TABLE, Item: latestItem } },
      ],
    })
  );
  console.log(
    `[saveAbsenceRecord] saved event_id=${record.event_id} characterId=${record.characterId}`
  );
}

/**
 * キャラクター記憶テーブルから、最新の不在期間の記録を強い整合性で取得する。
 * 項目が無い、または形式が現行の AbsenceRecord と合わない場合は null を返す。
 */
export async function getLatestAbsenceRecord(
  characterId: string
): Promise<AbsenceRecord | null> {
  const result = await dynamo.send(
    new GetCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      Key: { memory_id: characterId, index: LATEST_ABSENCE_RECORD_INDEX_KEY },
      ConsistentRead: true,
    })
  );
  if (!result.Item) {
    console.log(`[getLatestAbsenceRecord] not found characterId=${characterId}`);
    return null;
  }
  const record = (result.Item as LatestAbsenceRecordItem).record;
  if (!isAbsenceRecord(record)) {
    console.warn(`[getLatestAbsenceRecord] invalid record shape characterId=${characterId}`);
    return null;
  }
  return record;
}

/**
 * イベントテーブルの GSI（characterId-index）から、直近 limit 件の不在期間の記録を
 * 新しい順に取得する。旧形式の記録は読み飛ばす。読み飛ばしで件数が足りない場合は
 * 次のページを読み、limit 件集まるか、データが尽きるか、最大ページ数に達したら終える。
 */
export async function getRecentAbsenceRecords(
  characterId: string,
  limit: number
): Promise<AbsenceRecord[]> {
  if (limit <= 0) return [];

  const records: AbsenceRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  for (let page = 0; page < MAX_ABSENCE_RECORD_QUERY_PAGES; page++) {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: EVENTS_TABLE,
        IndexName: EVENTS_BY_CHARACTER_INDEX_NAME,
        KeyConditionExpression: "characterId = :cid",
        ExpressionAttributeValues: { ":cid": characterId },
        ScanIndexForward: false,
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    );

    for (const item of result.Items ?? []) {
      if (isAbsenceRecord(item)) {
        records.push(item);
        if (records.length >= limit) break;
      }
    }

    if (records.length >= limit) break;

    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!exclusiveStartKey) break;
  }

  console.log(
    `[getRecentAbsenceRecords] ${records.length} records for characterId=${characterId}`
  );
  return records;
}
