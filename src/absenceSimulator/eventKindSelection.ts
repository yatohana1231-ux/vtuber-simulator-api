// -------------------------------------------------------
// 出来事の件数と種類の抽選
//
// 骨格（生活リズム・出来事の種類・続きの話題）のうち、
// 「出来事の件数と種類の抽選」を担う。詳細な生成規則は
// .notes/decision-history.md の D-018 を参照。
// -------------------------------------------------------

import type { EventKind } from "../types.js";
import { weightedPick } from "../lib/random.js";

/** 出来事の件数の上限 */
export const MAX_EVENTS = 5;

/**
 * 不在時間（ミリ秒）から出来事の件数を決める。
 *
 * - elapsedMs が0以下なら0件。
 * - それ以外は、経過時間 h（時間、小数は切り捨て）として
 *   `1 + Math.floor(h / 12)` を 1〜MAX_EVENTS の範囲に収めた値。
 *   （3時間→1、11時間→1、12時間→2、24時間→3、36時間→4、48時間以上→5）
 */
export function countEvents(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;

  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const raw = 1 + Math.floor(hours / 12);
  return Math.min(MAX_EVENTS, Math.max(1, raw));
}

/**
 * 出来事の種類を count 件、重み付きで抽選する（同じ種類が複数回選ばれてよい）。
 * count が0以下なら空配列を返す。
 */
export function pickEventKinds(
  eventKinds: readonly EventKind[],
  count: number
): EventKind[] {
  if (count <= 0) return [];

  const result: EventKind[] = [];
  for (let i = 0; i < count; i++) {
    result.push(weightedPick(eventKinds, (kind) => kind.weight));
  }
  return result;
}
