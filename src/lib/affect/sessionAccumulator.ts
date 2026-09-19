// -------------------------------------------------------
// セッション（会話のまとまり）の途中経過と、ピーク・エンドでの確定（D-040）
//
// 関係値は発言ごとには動かさず、セッションが終わったときに、軸ごとに
// peak（絶対値がいちばん大きかった寄与）と last（最後の発言の寄与）の
// 平均を1回だけ反映する（ピーク・エンドの法則）。LLM も DB も使わない
// 純粋な関数（引数を書き換えず、新しいオブジェクトを返す。現在時刻は
// 引数で受け取る）。
// -------------------------------------------------------

import type { PendingSession, PerceptionContribution } from "../../types.js";
import type { AffectConfig } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG, PERCEPTION_KEYS } from "./affectConfig.js";

/**
 * 発言1回ぶんの寄与（perceptionDynamics.ts の computeMessageContribution の
 * 結果）をセッションの途中経過に足し込む。pending が無ければ新しく作る。
 */
export function addMessageToSession(
  pending: PendingSession | null,
  contribution: PerceptionContribution,
  now: Date
): PendingSession {
  const nowIso = now.toISOString();

  const peak: PerceptionContribution = {};
  const last: PerceptionContribution = {};
  for (const key of PERCEPTION_KEYS) {
    const currentValue = contribution[key] ?? 0;
    const previousPeak = pending?.peak[key] ?? 0;
    // 絶対値が大きいほうを peak にする。同じなら前のまま。
    peak[key] = Math.abs(currentValue) > Math.abs(previousPeak) ? currentValue : previousPeak;
    last[key] = currentValue;
  }

  return {
    startedAt: pending?.startedAt ?? nowIso,
    lastMessageAt: nowIso,
    messageCount: (pending?.messageCount ?? 0) + 1,
    peak,
    last,
  };
}

/** `now − lastMessageAt` が `sessionGapMinutes` 以上なら、セッションは終わったとみなす */
export function isSessionEnded(
  pending: PendingSession,
  now: Date,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): boolean {
  const elapsedMs = now.getTime() - new Date(pending.lastMessageAt).getTime();
  const gapMs = config.perception.sessionGapMinutes * 60 * 1000;
  return elapsedMs >= gapMs;
}

/** 軸ごとに (peak + last) / 2 を返す（ピーク・エンドの法則）。発言が1回だけなら peak = last になる */
export function settleSession(pending: PendingSession): PerceptionContribution {
  const result: PerceptionContribution = {};
  for (const key of PERCEPTION_KEYS) {
    const peakValue = pending.peak[key] ?? 0;
    const lastValue = pending.last[key] ?? 0;
    result[key] = (peakValue + lastValue) / 2;
  }
  return result;
}
