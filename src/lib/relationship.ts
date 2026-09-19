// -------------------------------------------------------
// 関係の段階・関係の履歴の決め方（LLM も DB も使わない純粋な関数。D-033）
//
// dialogueGenerator が、セリフを作る前に呼ぶ想定。関係の記録
// （RelationshipRecord）を「下がる → 履歴の更新 → 戻る → 上がる」の順で
// 更新し、段階が変わったら節目（RelationshipMilestone）を返す。節目は
// プレイヤーには伝えず、重要記憶とログに残すためだけに使う（保存・記録
// する側の責務。この関数自体は DynamoDB を呼ばない）。
// -------------------------------------------------------

import type {
  Perception,
  RelationshipMilestone,
  RelationshipRecord,
  RelationshipStage,
  RelationshipStagePromotion,
} from "../types.js";
import { getLocalParts } from "./timezone.js";

/** 最後にプレイヤーが発言してから、この日数以上経つと1段階下がる（キャラクターによらないゲームの決まり。D-033） */
export const DEMOTE_AFTER_DAYS = 60;

/** 下がったあと、この回数プレイヤーが発言すると、下がる前の段階（highestStageKey）に戻る */
export const RECOVERY_MESSAGES = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AdvanceRelationshipInput {
  record: RelationshipRecord | null; // 無ければ今回が初めて
  stages: RelationshipStage[]; // 先頭が最初の段階（1つ以上）
  perception: Perception; // DB にある現在の関係値（この関数は書き換えない）
  now: Date;
  timeZone: string; // 世界観のタイムゾーン（会話した日数の計算に使う）
  isPlayerMessage: boolean; // 空文字のログイン時の挨拶では false にする（発言として数えない）
}

export interface AdvanceRelationshipResult {
  record: RelationshipRecord;
  milestones: RelationshipMilestone[];
}

/**
 * stages の中での stageKey の位置。stages に見つからない場合（content の
 * 差し替えで段階の構成が変わった等）は、例外にせず先頭の段階（0）として扱う。
 */
function stageIndex(stageKey: string, stages: RelationshipStage[]): number {
  const index = stages.findIndex((stage) => stage.key === stageKey);
  return index === -1 ? 0 : index;
}

function meetsPromotion(
  promotion: RelationshipStagePromotion,
  record: RelationshipRecord,
  perception: Perception
): boolean {
  if (record.conversationDays < promotion.minConversationDays) return false;
  if (record.conversationCount < promotion.minConversationCount) return false;
  for (const key of Object.keys(promotion.minPerception) as Array<keyof Perception>) {
    const minValue = promotion.minPerception[key];
    if (minValue !== undefined && perception[key] < minValue) return false;
  }
  return true;
}

/** 世界観のタイムゾーンでの暦日（YYYY-MM-DD）。会話した日数の判定に使う */
function localDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = getLocalParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function advanceRelationship(input: AdvanceRelationshipInput): AdvanceRelationshipResult {
  const { stages, perception, now, timeZone, isPlayerMessage } = input;
  const nowIso = now.toISOString();

  // 入力の record は書き換えず、新しいオブジェクトから始める
  const record: RelationshipRecord = input.record
    ? { ...input.record }
    : {
        firstMetAt: nowIso,
        lastConversationAt: null,
        lastConversationDate: null,
        conversationCount: 0,
        conversationDays: 0,
        stageKey: stages[0].key,
        highestStageKey: stages[0].key,
        recoveryRemaining: 0,
        lastDemotedAt: null,
        updatedAt: nowIso,
      };

  const milestones: RelationshipMilestone[] = [];

  // 1. 下がる判定
  if (record.lastConversationAt !== null) {
    const elapsedMs = now.getTime() - new Date(record.lastConversationAt).getTime();
    const demoteThresholdMs = DEMOTE_AFTER_DAYS * MS_PER_DAY;
    // 同じ不在ではもう下げない（lastDemotedAt が今回の不在の lastConversationAt より後なら、
    // すでにこの不在で下げている）
    const alreadyDemotedForThisAbsence =
      record.lastDemotedAt !== null && record.lastDemotedAt >= record.lastConversationAt;

    if (elapsedMs >= demoteThresholdMs && !alreadyDemotedForThisAbsence) {
      const currentIndex = stageIndex(record.stageKey, stages);
      if (currentIndex > 0) {
        // 先頭の段階より下には下げない
        const fromStageKey = stages[currentIndex].key;
        const toStageKey = stages[currentIndex - 1].key;
        record.stageKey = toStageKey;
        record.recoveryRemaining = RECOVERY_MESSAGES;
        record.lastDemotedAt = nowIso;
        milestones.push({ kind: "demoted", fromStageKey, toStageKey, at: nowIso });
      }
    }
  }

  // 2. 履歴の更新（プレイヤーの発言があるときだけ。ログイン時の挨拶は数えない）
  if (isPlayerMessage) {
    record.conversationCount += 1;
    const todayKey = localDateKey(now, timeZone);
    if (record.lastConversationDate !== todayKey) {
      record.conversationDays += 1;
      record.lastConversationDate = todayKey;
    }
    record.lastConversationAt = nowIso;
  }

  // 下がっている間かどうか（手順3で減らす前、つまり「呼び出し開始時点ですでに下がっていた」
  // 場合と「手順1で今回下がった」場合の両方を含む時点で判定する）
  const wasRecovering = record.recoveryRemaining > 0;

  // 3. 戻る判定（プレイヤーの発言があるときだけ）
  if (isPlayerMessage && record.recoveryRemaining > 0) {
    record.recoveryRemaining -= 1;
    if (record.recoveryRemaining === 0) {
      const fromStageKey = record.stageKey;
      record.stageKey = record.highestStageKey;
      milestones.push({ kind: "recovered", fromStageKey, toStageKey: record.stageKey, at: nowIso });
    }
  }

  // 4. 上がる判定。下がっている間（wasRecovering。今回戻り切った場合も含む）は行わない
  if (!wasRecovering) {
    const currentIndex = stageIndex(record.stageKey, stages);
    const nextStage = stages[currentIndex + 1];
    if (nextStage && nextStage.promoteWhen && meetsPromotion(nextStage.promoteWhen, record, perception)) {
      const fromStageKey = record.stageKey;
      record.stageKey = nextStage.key;
      const highestIndex = stageIndex(record.highestStageKey, stages);
      if (currentIndex + 1 > highestIndex) {
        record.highestStageKey = record.stageKey;
      }
      milestones.push({ kind: "promoted", fromStageKey, toStageKey: record.stageKey, at: nowIso });
    }
  }

  record.updatedAt = nowIso;

  return { record, milestones };
}
