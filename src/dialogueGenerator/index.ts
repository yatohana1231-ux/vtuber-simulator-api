// -------------------------------------------------------
// dialogueGenerator
// これまでに生成したイベント・アクション・感情値を参照して
// キャラクターのセリフを生成する。
// 既存 conversation/index.mjs の dialogueGenerator 相当を TypeScript で再実装。
//
// 変更点（既存比）:
// - state_update 機構を削除（emotionUpdater に移譲）
// - buildSystemPrompt に events / actions / currentDatetime / longTimeFlag を追加
// - getMemories の読み出しを新保存形式（eventSummary + characterInterpretation）に対応
// - message="" 時は "（プレイヤーが来た）" を代替テキストとして Bedrock へ渡す
// - 会話ログ保存時に memoryRetrieverJudgedFlag=0 を付与
// -------------------------------------------------------

import Mustache from "mustache";

import PROMPT_TEMPLATE from "./prompts/conversation.mustache";
import { invokeModel } from "../lib/bedrock.js";
import {
  getCharacterState,
  getMemories,
  getRecentLogs,
  saveConversationLog,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../lib/dynamo.js";
import { formatDatetimeJST } from "../lib/utils.js";
import type {
  Action,
  CharacterMemoryItem,
  Mood,
  NormalizedRequest,
  Perception,
} from "../types.js";

const RECENT_LOG_LIMIT = 10;

// -------------------------------------------------------
// 引数型
// -------------------------------------------------------

export interface DialogueGeneratorArgs {
  req: NormalizedRequest;
  mood: Mood | undefined;       // undefined のとき DynamoDB から取得
  perception: Perception | undefined;
  events: string[];
  actions: Action[];
  longTimeFlag: 0 | 1;
}

// -------------------------------------------------------
// ラベルマップ
// -------------------------------------------------------

const MOOD_LABELS: Record<keyof Mood, string> = {
  joy: "喜び",
  anxiety: "不安",
  angry: "怒り",
  fatigue: "疲労",
  confidence: "自信",
  loneliness: "孤独感",
};

const PERCEPTION_LABELS: Record<keyof Perception, string> = {
  trust: "信頼",
  affection: "好感",
  respect: "尊敬",
  fear: "恐れ",
  dependence: "依存",
  familiarity: "親しみ",
};

function toLabel(value: number): string {
  if (value <= 20) return "ほとんど感じない";
  if (value <= 40) return "低い";
  if (value <= 60) return "標準";
  if (value <= 80) return "自覚している";
  return "強く感じる";
}

function formatState(
  obj: Record<string, number>,
  labels: Record<string, string>
): string {
  return Object.entries(obj)
    .map(([k, v]) => `・${labels[k] ?? k}：${v}（${toLabel(v)}）`)
    .join("\n");
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runDialogueGenerator(
  args: DialogueGeneratorArgs
): Promise<string> {
  console.log("[dialogueGenerator] start");

  const { req, events, actions, longTimeFlag } = args;
  const { characterId, profile, now } = req;

  // 感情・関係値を取得（引数未指定の場合は DynamoDB から）
  let mood = args.mood;
  let perception = args.perception;
  if (!mood || !perception) {
    const state = await getCharacterState(characterId);
    mood = state.mood ?? { ...DEFAULT_MOOD };
    perception = state.perception ?? { ...DEFAULT_PERCEPTION };
  }

  // プレイヤーメッセージ（空欄の場合は代替テキスト）
  const playerMessage =
    req.message === "" ? "（プレイヤーが来た）" : req.message;

  // プレイヤー発言を会話ログに保存
  await saveConversationLog(characterId, "user", playerMessage, 0);

  // 直近会話を取得（末尾は今保存した user ログなので除く）
  const recentLogs = await getRecentLogs(characterId, RECENT_LOG_LIMIT);
  const historyLogs = recentLogs.slice(0, -1);

  // 重要記憶を取得（新形式: eventSummary + characterInterpretation）
  const memories = await getMemories(profile.name);

  // システムプロンプトを組み立てる
  const systemPrompt = buildSystemPrompt({
    profile,
    mood,
    perception,
    memories,
    historyLogs: historyLogs.map((l) => ({
      role: l.role,
      content: l.content,
      index: l.index,
    })),
    events,
    actions,
    currentDatetime: formatDatetimeJST(now.toISOString()),
    longTimeFlag,
  });

  console.log("[dialogueGenerator] systemPrompt built");

  // Bedrock を呼び出してセリフを取得
  const reply = await invokeModel(systemPrompt, playerMessage, 500);

  console.log("[dialogueGenerator] reply:", reply);

  // キャラクターのセリフを会話ログに保存
  await saveConversationLog(characterId, "assistant", reply, 0);

  return reply;
}

// -------------------------------------------------------
// プロンプト組み立て
// -------------------------------------------------------

interface BuildSystemPromptArgs {
  profile: NormalizedRequest["profile"];
  mood: Mood;
  perception: Perception;
  memories: CharacterMemoryItem[];
  historyLogs: Array<{ role: string; content: string; index: string }>;
  events: string[];
  actions: Action[];
  currentDatetime: string;
  longTimeFlag: 0 | 1;
}

function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const {
    profile,
    mood,
    perception,
    memories,
    historyLogs,
    events,
    actions,
    currentDatetime,
    longTimeFlag,
  } = args;

  // 記憶テキスト（eventSummary + characterInterpretation を結合）
  const memoriesText =
    memories.length > 0
      ? memories
          .map((m) => {
            const summary = m.eventSummary ?? "";
            const interp = m.characterInterpretation
              ? `→ ${m.characterInterpretation}`
              : "";
            return `・${summary}${interp ? " " + interp : ""}`;
          })
          .join("\n")
      : "（なし）";

  // 会話履歴テキスト
  const historyText =
    historyLogs.length > 0
      ? historyLogs
          .map((log) => {
            const speaker = log.role === "user" ? "プレイヤー" : profile.name;
            const dt = formatDatetimeJST(log.index);
            return `${dt} （${speaker}）「${log.content}」`;
          })
          .join("\n")
      : "（なし）";

  // イベントテキスト
  const eventsText =
    events.length > 0
      ? events.map((e, i) => `${i + 1}. ${e}`).join("\n")
      : "";

  // アクションテキスト
  const actionsText =
    actions.length > 0
      ? actions
          .map(
            (a) =>
              `・${a.startDatetime.slice(0, 16)} 〜 ${a.endDatetime.slice(0, 16)}: ${a.action}（${a.memo}）`
          )
          .join("\n")
      : "";

  return Mustache.render(PROMPT_TEMPLATE, {
    name: profile.name,
    personality: profile.personality,
    speechStyle: profile.speechStyle,
    relationship: profile.relationship,
    moodText: formatState(mood as unknown as Record<string, number>, MOOD_LABELS as unknown as Record<string, string>),
    perceptionText: formatState(perception as unknown as Record<string, number>, PERCEPTION_LABELS as unknown as Record<string, string>),
    memoriesText,
    historyText,
    eventsText,
    actionsText,
    hasEvents: eventsText !== "",
    hasActions: actionsText !== "",
    currentDatetime,
    hasLongTimeFlag: longTimeFlag === 1,
  });
}
