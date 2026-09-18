// -------------------------------------------------------
// 不在期間の行動の枠（骨格）の展開
//
// 生活様式（Lifestyle.schedules）から、指定した期間に重なる行動の枠を
// 日ごとに展開する。時刻は世界観のタイムゾーン（timeZone）での壁時計の
// 時刻として扱い、実際の瞬間（UTC）への変換は src/lib/timezone.ts を使う。
// 詳細な生成規則は .notes/decision-history.md の D-018 を参照。
// -------------------------------------------------------

import type { ActionSlot, Lifestyle, ScheduleSlot } from "../types.js";
import { getLocalParts, localTimeToInstant, type LocalDateParts } from "../lib/timezone.js";

/** 切り詰めた後の長さがこの分数未満の枠は捨てる */
export const MIN_SLOT_MINUTES = 15;

/** 展開・切り詰め前の、実際の瞬間（Date）で表した枠 */
interface RawSlot {
  start: Date;
  end: Date;
  activity: string;
}

function parseHHMMToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 指定タイムゾーンでの、ある暦日の壁時計 0:00 の瞬間を求める */
function midnightOf(year: number, month: number, day: number, timeZone: string): Date {
  return localTimeToInstant(year, month, day, 0, 0, timeZone);
}

/**
 * windowStart の現地日付の前日から windowEnd の現地日付までの、暦日（0:00 時点の壁時計の値）を
 * 昇順で列挙する。
 */
function enumerateLocalDays(windowStart: Date, windowEnd: Date, timeZone: string): LocalDateParts[] {
  const startParts = getLocalParts(windowStart, timeZone);
  const endParts = getLocalParts(windowEnd, timeZone);

  const firstMidnight = midnightOf(startParts.year, startParts.month, startParts.day - 1, timeZone);
  const lastMidnight = midnightOf(endParts.year, endParts.month, endParts.day, timeZone);

  const days: LocalDateParts[] = [];
  let cursorInstant = firstMidnight;
  while (cursorInstant.getTime() <= lastMidnight.getTime()) {
    const cursorParts = getLocalParts(cursorInstant, timeZone);
    days.push(cursorParts);
    cursorInstant = midnightOf(cursorParts.year, cursorParts.month, cursorParts.day + 1, timeZone);
  }
  return days;
}

/** 指定した暦日（現地）の曜日から、平日/休日どちらの生活様式を使うかを選ぶ */
function scheduleForDay(lifestyle: Lifestyle, day: LocalDateParts): ScheduleSlot[] {
  const isHoliday = day.weekday === 0 || day.weekday === 6; // 日曜=0, 土曜=6
  return isHoliday ? lifestyle.schedules.holiday : lifestyle.schedules.weekday;
}

/** 生活様式の枠1件を、指定した暦日（現地）を起点に実際の瞬間へ展開する */
function expandSlot(day: LocalDateParts, slot: ScheduleSlot, timeZone: string): RawSlot {
  const startMinutes = parseHHMMToMinutes(slot.start);
  const endMinutes = parseHHMMToMinutes(slot.end);
  const startHour = Math.floor(startMinutes / 60);
  const startMinute = startMinutes % 60;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;

  const start = localTimeToInstant(day.year, day.month, day.day, startHour, startMinute, timeZone);

  // end <= start は日をまたぐ枠（翌日の end まで）
  const crossesMidnight = endMinutes <= startMinutes;
  const endDay = crossesMidnight ? day.day + 1 : day.day;
  const end = localTimeToInstant(day.year, day.month, endDay, endHour, endMinute, timeZone);

  return { start, end, activity: slot.activity };
}

/**
 * 生活様式から、[windowStart, windowEnd] に重なる行動の枠を展開する。
 *
 * 1. windowEnd <= windowStart なら空配列。
 * 2. windowStart の現地日付の前日から windowEnd の現地日付までの暦日ごとに、
 *    曜日（現地）に応じた平日/休日の生活様式を展開する。
 * 3. 開始時刻の昇順に並べ、重なりがあれば前の枠の終了を次の枠の開始まで切り詰める
 *    （後の日の枠を優先）。切り詰めで長さが0以下になった枠は捨てる。
 * 4. 各枠を [windowStart, windowEnd] との重なり部分に切り詰める。重なりがない枠は捨てる。
 * 5. 切り詰めた後の長さが MIN_SLOT_MINUTES 未満の枠は捨てる。
 */
export function buildActionSlots(args: {
  lifestyle: Lifestyle;
  timeZone: string;
  windowStart: Date;
  windowEnd: Date;
}): ActionSlot[] {
  const { lifestyle, timeZone, windowStart, windowEnd } = args;

  if (windowEnd.getTime() <= windowStart.getTime()) return [];

  const days = enumerateLocalDays(windowStart, windowEnd, timeZone);

  const rawSlots: RawSlot[] = [];
  for (const day of days) {
    for (const slot of scheduleForDay(lifestyle, day)) {
      rawSlots.push(expandSlot(day, slot, timeZone));
    }
  }

  rawSlots.sort((a, b) => a.start.getTime() - b.start.getTime());

  // 重なりの切り詰め: 後の日の枠を優先し、前の枠の終了を次の枠の開始まで切り詰める
  for (let i = 0; i < rawSlots.length - 1; i++) {
    const current = rawSlots[i];
    const next = rawSlots[i + 1];
    if (current.end.getTime() > next.start.getTime()) {
      current.end = next.start;
    }
  }

  const windowStartMs = windowStart.getTime();
  const windowEndMs = windowEnd.getTime();
  const minDurationMs = MIN_SLOT_MINUTES * 60 * 1000;

  const result: ActionSlot[] = [];
  for (const slot of rawSlots) {
    if (slot.end.getTime() <= slot.start.getTime()) continue; // 切り詰めで長さ0以下になった枠

    const clippedStartMs = Math.max(slot.start.getTime(), windowStartMs);
    const clippedEndMs = Math.min(slot.end.getTime(), windowEndMs);
    if (clippedEndMs <= clippedStartMs) continue; // 期間との重なりがない
    if (clippedEndMs - clippedStartMs < minDurationMs) continue; // 15分未満

    result.push({
      startDatetime: new Date(clippedStartMs).toISOString(),
      endDatetime: new Date(clippedEndMs).toISOString(),
      activity: slot.activity,
    });
  }

  result.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
  return result;
}
