// -------------------------------------------------------
// absenceSimulator のシステムプロンプトの組み立て
//
// プロンプトキャッシュ（D-017）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（absenceSimulator.fixed.mustache）: 同じパッケージなら毎回まったく同じ文字列。
//   日時・ID・件数など毎回変わる値は入れない。
// - ③ 可変部（absenceSimulator.variable.mustache）: 骨格・続きの話題・最近の出来事・重要記憶など、
//   毎回変わる入力。
// absenceSimulator には②（セッション部）は無い（D-020）。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/absenceSimulator.fixed.mustache";
import VARIABLE_TEMPLATE from "./prompts/absenceSimulator.variable.mustache";
import { buildPromptContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import { formatLocalDateTime } from "../lib/timezone.js";
import type {
  AbsenceSkeleton,
  AbsenceThread,
  CharacterDefinition,
  CharacterMemoryItem,
  World,
} from "../types.js";

export interface AbsenceSimulatorPromptInput {
  world: World;
  character: CharacterDefinition;
  skeleton: AbsenceSkeleton;
  openThreads: AbsenceThread[]; // 続いている話題（status が open のもの）
  recentEventSummaries: string[]; // 最近の記録の出来事の summary
  memories: CharacterMemoryItem[]; // 重要記憶
  /**
   * 不在に入ったときの気分・情動・欲求（formatAffectForPrompt の結果、D-040 フェーズ13b）。
   * 状態レコードが無い・古い形のときは undefined（③に節を出さない）
   */
  affectText?: string;
}

/** 不在期間のシミュレーションのシステムプロンプトを、層ごとの文字列の配列 [固定部, 可変部] で返す（D-017・D-020） */
export function buildAbsenceSimulatorPromptLayers(input: AbsenceSimulatorPromptInput): string[] {
  const { world, character, skeleton, openThreads, recentEventSummaries, memories, affectText } = input;
  const timeZone = world.timezone;

  const fixed = Mustache.render(FIXED_TEMPLATE, buildPromptContext(world, character), PROMPT_PARTIALS);

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    lastSeenText: formatLocalDateTime(new Date(skeleton.startDatetime), timeZone),
    nowText: formatLocalDateTime(new Date(skeleton.endDatetime), timeZone),
    elapsedText: formatElapsed(skeleton.startDatetime, skeleton.endDatetime),
    hasAffectText: Boolean(affectText),
    affectText: affectText ?? "",
    actionSlotsText: formatActionSlotsText(skeleton, timeZone),
    eventKindsText: formatEventKindsText(skeleton),
    openThreadsText: formatOpenThreadsText(openThreads, timeZone),
    recentEventSummariesText: formatRecentEventSummariesText(recentEventSummaries),
    memoriesText: formatMemoriesText(memories),
  });

  return [fixed, variable];
}

// -------------------------------------------------------
// 可変部の各セクションの文字列を作るヘルパー（すべて非export）
// -------------------------------------------------------

/** 経過時間を「1日3時間」「5時間」「45分」のような表記にする */
function formatElapsed(startDatetime: string, endDatetime: string): string {
  const elapsedMs = Math.max(0, new Date(endDatetime).getTime() - new Date(startDatetime).getTime());
  const totalMinutes = Math.floor(elapsedMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}日${hours}時間` : `${days}日`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
  }
  return `${minutes}分`;
}

/** 【行動の枠】: "番号. 開始〜終了 大まかな過ごし方" を1行ずつ */
function formatActionSlotsText(skeleton: AbsenceSkeleton, timeZone: string): string {
  if (skeleton.actionSlots.length === 0) return "（なし）";
  return skeleton.actionSlots
    .map((slot, i) => {
      const start = formatLocalDateTime(new Date(slot.startDatetime), timeZone);
      const end = formatLocalDateTime(new Date(slot.endDatetime), timeZone);
      return `${i + 1}. ${start}〜${end} ${slot.activity}`;
    })
    .join("\n");
}

/** 【出来事の種類（この順番・件数で書く）】: "番号. ラベル（kind: key）" を1行ずつ */
function formatEventKindsText(skeleton: AbsenceSkeleton): string {
  if (skeleton.eventKinds.length === 0) return "（なし）";
  return skeleton.eventKinds.map((kind, i) => `${i + 1}. ${kind.label}（kind: ${kind.key}）`).join("\n");
}

/** 【続いている話題】: "- [id: …] 話題（はじまり: 日時）" を1行ずつ */
function formatOpenThreadsText(threads: AbsenceThread[], timeZone: string): string {
  if (threads.length === 0) return "（なし）";
  return threads
    .map((thread) => {
      const openedAt = formatLocalDateTime(new Date(thread.openedAt), timeZone);
      return `- [id: ${thread.id}] ${thread.topic}（はじまり: ${openedAt}）`;
    })
    .join("\n");
}

/** 【最近の出来事（繰り返さない）】: "・要約" を1行ずつ */
function formatRecentEventSummariesText(summaries: string[]): string {
  if (summaries.length === 0) return "（なし）";
  return summaries.map((summary) => `・${summary}`).join("\n");
}

/** 【重要な記憶】: "・要約（キャラクターの解釈）" の形 */
function formatMemoriesText(memories: CharacterMemoryItem[]): string {
  if (memories.length === 0) return "（なし）";
  return memories
    .map((m) => `・${m.eventSummary ?? ""}${m.characterInterpretation ? "（" + m.characterInterpretation + "）" : ""}`)
    .join("\n");
}
