// -------------------------------------------------------
// 関係の記録（RelationshipRecord）を LLM プロンプト用の文章にする
//
// dialogueGenerator が、プロンプトの③可変部「【これまでの関係】」に
// 事実として入れる文章を組み立てる（D-033）。出会ってからの日数・会話した
// 日数・会話の回数・最後に話した日を、世界観のタイムゾーンの暦日で数える。
// 特定の世界観・キャラクターに依存する語は含めない。
// -------------------------------------------------------

import type { RelationshipRecord } from "../types.js";
import { getLocalParts } from "./timezone.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 2つの瞬間を、世界観のタイムゾーンでの暦日の差（日数）にする（時刻は無視する） */
function daysBetweenLocalDates(fromInstant: Date, toInstant: Date, timeZone: string): number {
  const from = getLocalParts(fromInstant, timeZone);
  const to = getLocalParts(toInstant, timeZone);
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

/**
 * 関係の記録を、プロンプトの「【これまでの関係】」に入れる事実の文章にする。
 * 例: 「出会ってから23日目。話した日は15日、会話は120回。最後に話したのは3日前。」
 *
 * まだプレイヤーの発言が無い（lastConversationAt が null）場合は、会話した日数・
 * 回数・最後に話した日の文を省く。出会った日が今日なら「今日はじめて会った。」、
 * それ以外は「出会ってからN日目。まだちゃんと話したことはない。」にする。
 */
export function formatRelationshipHistoryForPrompt(
  record: RelationshipRecord,
  now: Date,
  timeZone: string
): string {
  // 出会った日を1日目として数える（暦日の差 + 1）
  const daysSinceMet = daysBetweenLocalDates(new Date(record.firstMetAt), now, timeZone) + 1;

  if (record.lastConversationAt === null) {
    if (daysSinceMet <= 1) {
      return "今日はじめて会った。";
    }
    return `出会ってから${daysSinceMet}日目。まだちゃんと話したことはない。`;
  }

  const daysSinceLastConversation = daysBetweenLocalDates(new Date(record.lastConversationAt), now, timeZone);
  const lastConversationText =
    daysSinceLastConversation <= 0 ? "今日" : daysSinceLastConversation === 1 ? "昨日" : `${daysSinceLastConversation}日前`;

  return `出会ってから${daysSinceMet}日目。話した日は${record.conversationDays}日、会話は${record.conversationCount}回。最後に話したのは${lastConversationText}。`;
}
