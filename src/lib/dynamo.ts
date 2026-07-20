import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CharacterMemoryItem,
  CharacterStateItem,
  ConversationLogItem,
  EventItem,
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

/** キャラクターの重要記憶一覧を取得する */
export async function getMemories(characterName: string): Promise<CharacterMemoryItem[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      KeyConditionExpression: "memory_id = :mid",
      ExpressionAttributeValues: { ":mid": characterName },
    })
  );
  const memories = (result.Items ?? []) as CharacterMemoryItem[];
  console.log(`[getMemories] ${memories.length} memories for character=${characterName}`);
  return memories;
}

/** 重要記憶を 1 件保存する */
export async function saveMemory(item: CharacterMemoryItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: CHARACTER_MEMORY_TABLE, Item: item }));
  console.log(`[saveMemory] saved memory_id=${item.memory_id} index=${item.index}`);
}

// -------------------------------------------------------
// イベントテーブル
// -------------------------------------------------------

/** events テーブルにイベントを保存する */
export async function saveEvent(item: EventItem): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: EVENTS_TABLE, Item: item }));
  console.log(`[saveEvent] saved event_id=${item.event_id}`);
}
