// Lambda に配置する mjs ファイル
// Lambda 環境変数は以下
// BEDROCK_MODEL_ID: apac.amazon.nova-lite-v1:0
// CHARACTER_MEMORY_TABLE: arn:aws:dynamodb:ap-northeast-1:071471126926:table/v-simu-characters-memory-stg
// CONVERSATION_LOGS_TABLE: arn:aws:dynamodb:ap-northeast-1:071471126926:table/vtuber-simu-conversation-log-stg

import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import Mustache from "mustache";

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

// -------------------------------------------------------
// プロンプトテンプレートの読み込み（モジュール初期化時に一度だけ実行）
// -------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_TEMPLATE = await readFile(
  join(__dirname, "prompts", "conversation.mustache"),
  "utf-8"
);

// -------------------------------------------------------
// クライアント初期化
// -------------------------------------------------------
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MODEL_ID = process.env.BEDROCK_MODEL_ID;

// テーブル名は ARN から末尾のテーブル名部分を抽出して使う
// （DynamoDB SDK はテーブル名のみ受け付けるため）
const CONVERSATION_LOGS_TABLE = extractTableName(
  process.env.CONVERSATION_LOGS_TABLE
);
const CHARACTER_MEMORY_TABLE = extractTableName(
  process.env.CHARACTER_MEMORY_TABLE
);

// 直近会話の取得件数
const RECENT_LOG_LIMIT = 10;

// -------------------------------------------------------
// 感情・関係値のデフォルト値
// -------------------------------------------------------
const DEFAULT_MOOD = {
  joy: 35,
  anxiety: 62,
  angry: 20,
  fatigue: 48,
  confidence: 30,
  loneliness: 10,
};

const DEFAULT_PERCEPTION = {
  trust: 72,
  affection: 55,
  respect: 80,
  fear: 12,
  dependence: 30,
  familiarity: 65,
};

// CHARACTER_MEMORY_TABLE 内で感情・関係値を保存する固定 index キー
const STATE_INDEX_KEY = "state";

// -------------------------------------------------------
// ハンドラー
// -------------------------------------------------------
export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const body = parseRequestBody(event);

    if (!body.message) {
      return createResponse(400, { error: "message is required" });
    }

    const profile = normalizeProfile(body.characterProfile);

    // characterId はリクエストから受け取るか、新規発行
    // JsonUtility.ToJson (Unity) は null フィールドを "" にするため、空文字も除外する
    const characterId = body.characterId || randomUUID();
    const playerMessage = body.message;

    // ---- Step 1: プレイヤーの発言を CONVERSATION_LOGS_TABLE へ保存 ----
    await saveLog(characterId, "user", playerMessage);

    // ---- Step 2: CONVERSATION_LOGS_TABLE から直近会話を取得 ----
    const recentLogs = await getRecentLogs(characterId);

    // ---- Step 3: CHARACTER_MEMORY_TABLE から重要記憶を取得 ----
    const memories = await getMemories(profile.name);

    // ---- Step 4: CHARACTER_MEMORY_TABLE から感情・関係値を取得 ----
    const { mood, perception } = await getCharacterState(characterId);

    // ---- Step 5: Bedrock に渡すプロンプトを組み立てる ----
    // 末尾は今回保存した user ログなので除外して履歴とする
    const historyLogs = recentLogs.slice(0, -1);
    const systemPrompt = buildSystemPrompt(
      profile,
      memories,
      historyLogs,
      mood,
      perception
    );
    console.log("systemPrompt");
    console.log(systemPrompt);

    // ---- Step 6: Bedrock からセリフを取得 ----
    const rawReply = await invokeBedrockModel(systemPrompt, playerMessage);

    // ---- Step 7: セリフと感情・関係値の更新差分を分離する ----
    const { reply, updatedMood, updatedPerception } = parseReply(
      rawReply,
      mood,
      perception
    );

    // ---- Step 8: キャラクターのセリフを CONVERSATION_LOGS_TABLE へ保存 ----
    await saveLog(characterId, "assistant", reply);

    // ---- Step 9: 更新された感情・関係値を CHARACTER_MEMORY_TABLE へ保存 ----
    await saveCharacterState(characterId, updatedMood, updatedPerception);

    // ---- Step 10: レスポンスを返す ----
    return createResponse(200, {
      characterId,
      reply,
      mood: updatedMood,
      perception: updatedPerception,
    });
  } catch (error) {
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: error.name,
      errorMessage: error.message,
    });
  }
};

// -------------------------------------------------------
// DynamoDB ヘルパー
// -------------------------------------------------------

/**
 * 会話ログを 1 件保存する
 * @param {string} characterId - パーティションキー
 * @param {"user"|"assistant"} role
 * @param {string} content
 */
async function saveLog(characterId, role, content) {
  const index = new Date().toISOString();

  const item = {
    conversation_id: characterId,
    index,
    role,
    content,
  };

  await dynamoClient.send(
    new PutCommand({
      TableName: CONVERSATION_LOGS_TABLE,
      Item: item,
    })
  );

  console.log(`Saved log [${role}] character_id=${characterId} index=${index}`);
}

/**
 * 直近の会話ログを取得する（古い順）
 * @param {string} characterId
 * @returns {Array<{role: string, content: string, index: string}>}
 */
async function getRecentLogs(characterId) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: CONVERSATION_LOGS_TABLE,
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": characterId,
      },
      ScanIndexForward: false,
      Limit: RECENT_LOG_LIMIT,
    })
  );

  const logs = (result.Items ?? []).reverse();
  console.log(
    `Fetched ${logs.length} recent logs for character_id=${characterId}`
  );
  return logs;
}

/**
 * キャラクターの重要記憶を取得する
 * @param {string} characterName - CHARACTER_MEMORY_TABLE のパーティションキー (memory_id)
 * @returns {Array<{memory_id: string, index: string, content: string}>}
 */
async function getMemories(characterName) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      KeyConditionExpression: "memory_id = :mid",
      ExpressionAttributeValues: {
        ":mid": characterName,
      },
    })
  );

  const memories = result.Items ?? [];
  console.log(
    `Fetched ${memories.length} memories for character=${characterName}`
  );
  return memories;
}

/**
 * キャラクターの感情・関係値を取得する
 * CHARACTER_MEMORY_TABLE に memory_id=characterId, index="state" で保存する
 * @param {string} characterId
 * @returns {{ mood: object, perception: object }}
 */
async function getCharacterState(characterId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      Key: {
        memory_id: characterId,
        index: STATE_INDEX_KEY,
      },
    })
  );

  if (!result.Item) {
    console.log(
      `No character state found for characterId=${characterId}. Using defaults.`
    );
    return {
      mood: { ...DEFAULT_MOOD },
      perception: { ...DEFAULT_PERCEPTION },
    };
  }

  const mood = result.Item.mood ?? { ...DEFAULT_MOOD };
  const perception = result.Item.perception ?? { ...DEFAULT_PERCEPTION };

  console.log(
    `Fetched character state for characterId=${characterId}:`,
    JSON.stringify({ mood, perception })
  );
  return { mood, perception };
}

/**
 * キャラクターの感情・関係値を保存する
 * @param {string} characterId
 * @param {object} mood
 * @param {object} perception
 */
async function saveCharacterState(characterId, mood, perception) {
  await dynamoClient.send(
    new PutCommand({
      TableName: CHARACTER_MEMORY_TABLE,
      Item: {
        memory_id: characterId,
        index: STATE_INDEX_KEY,
        mood,
        perception,
        updatedAt: new Date().toISOString(),
      },
    })
  );

  console.log(
    `Saved character state for characterId=${characterId}:`,
    JSON.stringify({ mood, perception })
  );
}

// -------------------------------------------------------
// Bedrock ヘルパー
// -------------------------------------------------------

/**
 * Bedrock Converse API を呼び出してキャラクターのセリフを返す
 * @param {string} systemPrompt
 * @param {string} playerMessage
 * @returns {string}
 */
async function invokeBedrockModel(systemPrompt, playerMessage) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: playerMessage }],
      },
    ],
    inferenceConfig: {
      maxTokens: 500,
      temperature: 0.8,
      topP: 0.9,
    },
  });

  const result = await bedrockClient.send(command);

  const rawReply =
    result.output?.message?.content
      ?.map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

  return rawReply;
}

// -------------------------------------------------------
// レスポンスのパース
// -------------------------------------------------------

/**
 * Bedrock の生出力からセリフと感情・関係値の更新差分を分離する
 *
 * モデルには以下フォーマットで出力させる:
 *   （セリフ本文）
 *   <state_update>{"mood":{"joy":5},"perception":{"trust":-3}}</state_update>
 *
 * - <state_update> ブロックが存在しない場合は現在値をそのまま返す
 * - 差分は現在値に加算し、1〜100 にクランプする
 * @param {string} rawReply
 * @param {object} currentMood
 * @param {object} currentPerception
 * @returns {{ reply: string, updatedMood: object, updatedPerception: object }}
 */
function parseReply(rawReply, currentMood, currentPerception) {
  const stateUpdateRegex =
    /<state_update>([\s\S]*?)<\/state_update>/i;
  const match = rawReply.match(stateUpdateRegex);

  // <state_update> を除去したテキストがセリフ
  const reply = rawReply.replace(stateUpdateRegex, "").trim();

  let updatedMood = { ...currentMood };
  let updatedPerception = { ...currentPerception };

  if (match) {
    try {
      const delta = JSON.parse(match[1].trim());

      if (delta.mood && typeof delta.mood === "object") {
        updatedMood = applyDelta(currentMood, delta.mood);
      }

      if (delta.perception && typeof delta.perception === "object") {
        updatedPerception = applyDelta(currentPerception, delta.perception);
      }

      console.log("State delta applied:", JSON.stringify(delta));
    } catch (e) {
      console.warn("Failed to parse state_update JSON:", match[1], e.message);
    }
  }

  console.log("Parsed reply:", reply);
  console.log("Updated mood:", JSON.stringify(updatedMood));
  console.log("Updated perception:", JSON.stringify(updatedPerception));

  return { reply, updatedMood, updatedPerception };
}

/**
 * 差分オブジェクトを現在値に加算し、1〜100 にクランプして返す
 * 既存キー以外の差分は無視する（不正なキーの混入を防ぐ）
 * @param {object} current
 * @param {object} delta
 * @returns {object}
 */
function applyDelta(current, delta) {
  const updated = { ...current };
  for (const key of Object.keys(current)) {
    if (key in delta) {
      const newVal = current[key] + Number(delta[key]);
      updated[key] = Math.min(100, Math.max(1, Math.round(newVal)));
    }
  }
  return updated;
}

// -------------------------------------------------------
// プロンプト組み立て
// -------------------------------------------------------

/**
 * Mustache テンプレートに変数を渡してシステムプロンプトを生成する
 * @param {object} profile
 * @param {Array} memories
 * @param {Array<{role: string, content: string, index: string}>} historyLogs
 * @param {object} mood
 * @param {object} perception
 * @returns {string}
 */
function buildSystemPrompt(profile, memories, historyLogs, mood, perception) {
  const MOOD_LABELS = {
    joy: "喜び",
    anxiety: "不安",
    angry: "怒り",
    fatigue: "疲労",
    confidence: "自信",
    loneliness: "孤独感",
  };
  const PERCEPTION_LABELS = {
    trust: "信頼",
    affection: "好感",
    respect: "尊敬",
    fear: "恐れ",
    dependence: "依存",
    familiarity: "親しみ",
  };

  const toLabel = (value) => {
    if (value <= 20) return "ほとんど感じない";
    if (value <= 40) return "低い";
    if (value <= 60) return "標準";
    if (value <= 80) return "自覚している";
    return "強く感じる";
  };

  const formatState = (obj, labels) =>
    Object.entries(obj)
      .map(([k, v]) => `・${labels[k] ?? k}：${v}（${toLabel(v)}）`)
      .join("\n");

  const memoriesText =
    memories.length > 0
      ? memories.map((m) => `・${m.content ?? JSON.stringify(m)}`).join("\n")
      : "（なし）";

  const historyText =
    historyLogs.length > 0
      ? historyLogs
          .map((log) => {
            const speaker = log.role === "user" ? "プレイヤー" : profile.name;
            const dt = formatDatetime(log.index);
            return `${dt} （${speaker}）「${log.content}」`;
          })
          .join("\n")
      : "（なし）";

  return Mustache.render(PROMPT_TEMPLATE, {
    name: profile.name,
    personality: profile.personality,
    speechStyle: profile.speechStyle,
    relationship: profile.relationship,
    moodText: formatState(mood, MOOD_LABELS),
    perceptionText: formatState(perception, PERCEPTION_LABELS),
    memoriesText,
    historyText,
  });
}


// -------------------------------------------------------
// 共通ユーティリティ
// -------------------------------------------------------

/**
 * ARN またはテーブル名文字列からテーブル名を返す
 * ARN 形式: arn:aws:dynamodb:region:account:table/TableName
 * @param {string|undefined} arnOrName
 * @returns {string}
 */
function extractTableName(arnOrName) {
  if (!arnOrName) return "";
  if (arnOrName.startsWith("arn:")) {
    return arnOrName.split("/").pop();
  }
  return arnOrName;
}

function parseRequestBody(event) {
  if (!event) return {};
  if (!("body" in event)) return event;
  if (!event.body) return {};

  let body = event.body;
  if (event.isBase64Encoded) {
    body = Buffer.from(body, "base64").toString("utf8");
  }
  return JSON.parse(body);
}

function normalizeProfile(profile) {
  return {
    name: profile?.name ?? "少女",
    personality: profile?.personality ?? "明るく前向き",
    speechStyle: profile?.speechStyle ?? "丁寧語",
    relationship: profile?.relationship ?? "初対面のプロデューサー候補",
  };
}

function formatDatetime(isoString) {
  if (!isoString) return "（日時不明）";
  const d = new Date(isoString);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function createResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    },
    body: JSON.stringify(body),
  };
}
