// -------------------------------------------------------
// 不在期間の骨格の組み立て
//
// 行動の枠（buildActionSlots）と出来事の種類の抽選（countEvents /
// pickEventKinds）を組み合わせ、不在期間全体の骨格（AbsenceSkeleton）を
// 作る。生成規則は .notes/decision-history.md の D-018 を参照。
// -------------------------------------------------------

import type { AbsenceSkeleton, Lifestyle } from "../types.js";
import { buildActionSlots } from "./actionSlots.js";
import { countEvents, pickEventKinds } from "./eventKindSelection.js";

/** 行動の枠を展開する対象期間（今回ログインまでの直近）の上限時間 */
export const MAX_ACTION_WINDOW_HOURS = 12;

/**
 * 不在期間の骨格を組み立てる。
 *
 * - 経過時間（elapsedMs = now - lastLoginAt）が負の場合は0として扱う
 *   （now が lastLoginAt より前でも例外にしない。入力値の検証はハンドラー handlers/absenceSimulator.ts で行う）。
 * - 行動の枠は、今回ログイン（now）までの直近 MAX_ACTION_WINDOW_HOURS 時間が上限。
 * - 出来事の件数は、行動の枠の上限（12時間）では切らず、不在期間全体（elapsedMs）で決める。
 * - lastLoginAt / now が不正な Date（NaN）の場合の扱いは決めない（呼び出し元の
 *   ハンドラーで入力を検証している）。
 */
export function buildAbsenceSkeleton(args: {
  lifestyle: Lifestyle;
  timeZone: string;
  lastLoginAt: Date;
  now: Date;
}): AbsenceSkeleton {
  const { lifestyle, timeZone, lastLoginAt, now } = args;

  const elapsedMs = Math.max(0, now.getTime() - lastLoginAt.getTime());

  const actionWindowMs = Math.min(elapsedMs, MAX_ACTION_WINDOW_HOURS * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - actionWindowMs);

  const actionSlots = buildActionSlots({
    lifestyle,
    timeZone,
    windowStart,
    windowEnd: now,
  });

  const eventKinds = pickEventKinds(lifestyle.eventKinds, countEvents(elapsedMs));

  return {
    startDatetime: lastLoginAt.toISOString(),
    endDatetime: now.toISOString(),
    actionSlots,
    eventKinds,
  };
}
