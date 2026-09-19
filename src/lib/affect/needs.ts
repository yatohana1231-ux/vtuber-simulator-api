// -------------------------------------------------------
// 欲求（疲労・孤独感）の計算（D-040）
//
// LLM も DB も使わない純粋な関数（現在時刻は引数で受け取る）。
// 疲労は保存した値を使わず、生活様式（Lifestyle）だけから毎回計算し直す。
// 孤独感は保存してある値に、会っていない時間ぶんの増分を足す。
// -------------------------------------------------------

import type { AffectConfig, AffectProfile } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG } from "./affectConfig.js";
import type { Lifestyle, ScheduleSlot } from "../../types.js";
import { buildActionSlots } from "../../absenceSimulator/actionSlots.js";
import { getLocalParts } from "../timezone.js";

const MS_PER_HOUR = 60 * 60 * 1000;

/** 0〜100 に収める（丸めない） */
function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * ある枠（ActionSlot）の activity に対応する fatigueChangePerHour を、
 * 枠の開始時刻（世界観のタイムゾーンでの現地日）が平日・休日どちらかによって
 * schedules.weekday / schedules.holiday のどちらかから引く。
 * 同じ activity が複数あれば先頭、見つからなければ 0（省略時と同じ扱い）。
 */
function lookupFatigueChangePerHour(lifestyle: Lifestyle, timeZone: string, startDatetime: string, activity: string): number {
  const localDay = getLocalParts(new Date(startDatetime), timeZone);
  const isHoliday = localDay.weekday === 0 || localDay.weekday === 6; // 日曜=0, 土曜=6（actionSlots.ts と同じ判定）
  const schedules: ScheduleSlot[] = isHoliday ? lifestyle.schedules.holiday : lifestyle.schedules.weekday;
  const otherSchedules: ScheduleSlot[] = isHoliday ? lifestyle.schedules.weekday : lifestyle.schedules.holiday;
  // 日をまたぐ枠が期間の開始で切り詰められると、枠の開始日と、もとの生活様式の日がずれる
  // （例: 金曜 23:00 からの就寝が、土曜 03:00 開始に切り詰められる）。その日の生活様式に
  // 同じ activity が無ければ、もう一方の生活様式からも探す。
  const found =
    schedules.find((slot) => slot.activity === activity) ?? otherSchedules.find((slot) => slot.activity === activity);
  return found?.fatigueChangePerHour ?? 0;
}

/**
 * 生活様式だけから、今の疲労を計算する（保存した値は使わない）。
 * `now - fatigueLookbackHours` を fatigueBaseline とし、そこから now までの行動の枠
 * （buildActionSlots で展開、古い順）を順にたどって、枠ごとに
 * fatigueChangePerHour × 枠の時間 を足し、枠ごとに 0〜100 に収める。
 */
export function computeFatigue(
  lifestyle: Lifestyle,
  timeZone: string,
  now: Date,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): number {
  const windowStart = new Date(now.getTime() - config.needs.fatigueLookbackHours * MS_PER_HOUR);
  const slots = buildActionSlots({ lifestyle, timeZone, windowStart, windowEnd: now });

  let fatigue = config.needs.fatigueBaseline;
  for (const slot of slots) {
    const rate = lookupFatigueChangePerHour(lifestyle, timeZone, slot.startDatetime, slot.activity);
    const hours = (new Date(slot.endDatetime).getTime() - new Date(slot.startDatetime).getTime()) / MS_PER_HOUR;
    fatigue = clamp0to100(fatigue + rate * hours);
  }

  return fatigue;
}

export interface ProjectLonelinessContext {
  dependence: number; // 関係値の dependence（1〜100）
  stageIndex: number; // 今の関係の段階の位置（0が最初）
  stageCount: number; // 段階の総数
  profile: AffectProfile;
}

/**
 * 段階の位置（0〜stageCount-1）から、孤独感の増え方の係数を求める。
 * 最初の段階（0） → lonelinessFirstStageFactor、最後の段階（stageCount-1） → 1、
 * 間は直線で補う。段階が1つだけなら 1。
 */
function stageFactor(stageIndex: number, stageCount: number, config: AffectConfig): number {
  if (stageCount <= 1) return 1;
  const first = config.needs.lonelinessFirstStageFactor;
  const ratio = stageIndex / (stageCount - 1);
  return first + (1 - first) * ratio;
}

/** dependence（1〜100）を min〜max に直線で対応させる */
function dependenceFactor(dependence: number, config: AffectConfig): number {
  const { min, max } = config.needs.lonelinessDependenceFactor;
  const ratio = (dependence - 1) / (100 - 1);
  return min + (max - min) * ratio;
}

/**
 * 会っていない時間ぶん、孤独感を進める。
 * 経過が sessionGapMinutes 未満なら変えない。増える量は
 * lonelinessGrowthPerDay × 経過日数 × 段階の係数 × dependence の係数 × 愛着の係数 × lonelinessGrowthScale。
 * 結果は lonelinessMaxFromAbsence を超えない（もとの値がすでに超えていれば、もとの値のまま）。
 */
export function projectLoneliness(
  loneliness: number,
  elapsedHours: number,
  ctx: ProjectLonelinessContext,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): number {
  const elapsedMinutes = elapsedHours * 60;
  if (elapsedMinutes < config.perception.sessionGapMinutes) return loneliness;

  const elapsedDays = elapsedHours / 24;
  const increase =
    config.needs.lonelinessGrowthPerDay *
    elapsedDays *
    stageFactor(ctx.stageIndex, ctx.stageCount, config) *
    dependenceFactor(ctx.dependence, config) *
    config.needs.lonelinessAttachmentFactor[ctx.profile.attachmentStyle] *
    ctx.profile.lonelinessGrowthScale;

  const max = config.needs.lonelinessMaxFromAbsence;
  if (loneliness > max) return loneliness; // もとの値がすでに上限を超えていれば、そのまま

  return Math.min(loneliness + increase, max);
}

/** プレイヤーの発言1回で孤独感を減らす（下限0） */
export function relieveLonelinessByMessage(
  loneliness: number,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): number {
  return Math.max(0, loneliness - config.needs.lonelinessReliefPerMessage);
}
