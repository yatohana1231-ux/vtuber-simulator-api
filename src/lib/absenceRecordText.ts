// -------------------------------------------------------
// 不在期間の記録（AbsenceRecord）を LLM プロンプト用の文章にする
//
// dialogueGenerator・emotionUpdater・memoryRetriever の3機能が、
// DynamoDB から読んだ不在期間の記録をプロンプトに載せるための
// 共通処理（D-022）。期間・出来事・行動・続いている話題を、世界観の
// タイムゾーンでの表記に整形する。特定の世界観やキャラクターに
// 依存する語は含めない。
//
// formatAbsenceRecordAsInputText は、emotionUpdater（process=1）・
// memoryRetriever（process=1）が更新・判定のインプット文として使う
// 「【不在中の出来事】…【不在中の行動】…」の組み立て（A-9）。
// -------------------------------------------------------

import type { AbsenceRecord } from "../types.js";
import { formatLocalDateTime } from "./timezone.js";

export interface AbsenceRecordPromptTexts {
  periodText: string; // "2026/09/18(金) 22:00 〜 2026/09/19(土) 10:00"
  eventsText: string; // 出来事。無ければ "（なし）"
  actionsText: string; // 行動。無ければ "（なし）"
  openThreadsText: string; // status が "open" の話題。無ければ "（なし）"
}

const EMPTY_TEXT = "（なし）";

/** 不在期間の記録を、プロンプトに載せる文章にする */
export function formatAbsenceRecordForPrompt(
  record: AbsenceRecord,
  timeZone: string
): AbsenceRecordPromptTexts {
  const periodText = `${formatLocalDateTime(new Date(record.startDatetime), timeZone)} 〜 ${formatLocalDateTime(
    new Date(record.endDatetime),
    timeZone
  )}`;

  const eventsText =
    record.events.length === 0
      ? EMPTY_TEXT
      : record.events
          .map((event, i) => `${i + 1}. ${event.summary}\n   ${event.detail}`)
          .join("\n");

  const actionsText =
    record.actions.length === 0
      ? EMPTY_TEXT
      : record.actions
          .map((action) => {
            const start = formatLocalDateTime(new Date(action.startDatetime), timeZone);
            const end = formatLocalDateTime(new Date(action.endDatetime), timeZone);
            const memoSuffix = action.memo ? `（${action.memo}）` : "";
            return `・${start}〜${end} ${action.action}${memoSuffix}`;
          })
          .join("\n");

  const openThreads = record.threads.filter((thread) => thread.status === "open");
  const openThreadsText =
    openThreads.length === 0
      ? EMPTY_TEXT
      : openThreads.map((thread) => `・${thread.topic}`).join("\n");

  return { periodText, eventsText, actionsText, openThreadsText };
}

/** 不在期間の記録を、emotionUpdater（process=1）・memoryRetriever（process=1）の更新・判定用インプット文にする */
export function formatAbsenceRecordAsInputText(record: AbsenceRecord, timeZone: string): string {
  const { periodText, eventsText, actionsText } = formatAbsenceRecordForPrompt(record, timeZone);
  return `【不在中の出来事】（期間: ${periodText}）\n${eventsText}\n\n【不在中の行動】\n${actionsText}`;
}
