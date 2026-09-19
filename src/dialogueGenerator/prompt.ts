// -------------------------------------------------------
// dialogueGenerator のシステムプロンプトの組み立て
//
// プロンプトキャッシュ（D-017・D-022）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（conversation.fixed.mustache）: 同じパッケージなら毎回まったく同じ文字列。
//   日時・感情・記録・長期不在フラグなど毎回変わる値は入れない。
// - ② セッション部（conversation.session.mustache）: 最新の不在期間の記録。
//   記録が無ければ空文字（bedrock.ts の invokeModel が空の層を除く）。
// - ③ 可変部（conversation.variable.mustache）: 現在時刻・感情・関係値・
//   長期不在の備考・重要な記憶・最近の会話など、会話のたびに変わる入力。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/conversation.fixed.mustache";
import SESSION_TEMPLATE from "./prompts/conversation.session.mustache";
import VARIABLE_TEMPLATE from "./prompts/conversation.variable.mustache";
import { buildPromptContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import { formatAbsenceRecordForPrompt } from "../lib/absenceRecordText.js";
import { formatLocalDateTime } from "../lib/timezone.js";
import { formatMoodForPrompt, formatPerceptionForPrompt } from "../lib/characterStateText.js";
import type {
  AbsenceRecord,
  CharacterDefinition,
  CharacterMemoryItem,
  Mood,
  Perception,
  World,
} from "../types.js";

export interface HistoryLogForPrompt {
  role: string;
  content: string;
  index: string; // ISO8601 タイムスタンプ
}

export interface DialogueGeneratorPromptInput {
  world: World;
  character: CharacterDefinition;
  mood: Mood;
  perception: Perception;
  memories: CharacterMemoryItem[];
  historyLogs: HistoryLogForPrompt[];
  latestAbsenceRecord: AbsenceRecord | null; // 無ければセッション部は空文字にする
  now: Date;
  longTimeFlag: 0 | 1;
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

/** dialogueGenerator のシステムプロンプトを、層ごとの文字列の配列 [固定部, セッション部, 可変部] で返す */
export function buildDialogueGeneratorPromptLayers(input: DialogueGeneratorPromptInput): string[] {
  const {
    world,
    character,
    mood,
    perception,
    memories,
    historyLogs,
    latestAbsenceRecord,
    now,
    longTimeFlag,
  } = input;
  const timeZone = world.timezone;

  const fixed = Mustache.render(FIXED_TEMPLATE, buildPromptContext(world, character), PROMPT_PARTIALS);

  const session = latestAbsenceRecord
    ? Mustache.render(SESSION_TEMPLATE, formatAbsenceRecordForPrompt(latestAbsenceRecord, timeZone))
    : "";

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    currentDatetime: formatLocalDateTime(now, timeZone),
    moodText: formatMoodForPrompt(mood),
    perceptionText: formatPerceptionForPrompt(perception),
    memoriesText: formatMemoriesText(memories),
    historyText: formatHistoryText(historyLogs, character.name, timeZone),
    hasLongTimeFlag: longTimeFlag === 1,
  });

  return [fixed, session, variable];
}

// -------------------------------------------------------
// 可変部の各セクションの文字列を作るヘルパー（すべて非export）
// -------------------------------------------------------

/** 【重要な記憶】: "・要約 → キャラクターの解釈" の形 */
function formatMemoriesText(memories: CharacterMemoryItem[]): string {
  if (memories.length === 0) return "（なし）";
  return memories
    .map((m) => {
      const summary = m.eventSummary ?? "";
      const interp = m.characterInterpretation ? `→ ${m.characterInterpretation}` : "";
      return `・${summary}${interp ? " " + interp : ""}`;
    })
    .join("\n");
}

/** 【最近の会話】: "日時 （話者）「発言」" を1行ずつ */
function formatHistoryText(
  logs: HistoryLogForPrompt[],
  characterName: string,
  timeZone: string
): string {
  if (logs.length === 0) return "（なし）";
  return logs
    .map((log) => {
      const speaker = log.role === "user" ? "プレイヤー" : characterName;
      const dt = formatLocalDateTime(new Date(log.index), timeZone);
      return `${dt} （${speaker}）「${log.content}」`;
    })
    .join("\n");
}
