// -------------------------------------------------------
// タイムゾーン変換（追加ライブラリなし、Intl.DateTimeFormat のみで実装）
//
// 不在期間のシミュレーション（フェーズ2以降）で、世界観のタイムゾーン
// （World.timezone、例: "Asia/Tokyo"）での壁時計の時刻と、実際の瞬間
// （UTC の Date）を相互に変換するために使う。
// -------------------------------------------------------

/** ある瞬間を、指定タイムゾーンでの壁時計の値に分解したもの */
export interface LocalDateParts {
  year: number;
  month: number; // 1〜12
  day: number;
  hour: number; // 0〜23
  minute: number;
  weekday: number; // 0=日曜 〜 6=土曜
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Intl.DateTimeFormat はタイムゾーンごとに生成コストがかかるため、フォーマッタを再利用する
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23", // 24時表記。真夜中は "00" になるはずだが、環境によって "24" が返ることがあるため呼び出し側でも防御する
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** ある瞬間を、指定タイムゾーンでの壁時計の値（年月日時分・曜日）に分解する */
export function getLocalParts(instant: Date, timeZone: string): LocalDateParts {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  // hourCycle: "h23" で "24" が返ってきた場合は 0 として扱う
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

/** 指定タイムゾーンでの壁時計の値（分単位）と、その値をそのまま UTC として解釈した ms 値との差（オフセット） */
function getOffsetMs(instant: Date, timeZone: string): number {
  const parts = getLocalParts(instant, timeZone);
  const asIfUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return asIfUTC - instant.getTime();
}

/**
 * 指定タイムゾーンでの壁時計の日時（年月日時分）に対応する瞬間を返す。
 * `day` は 0 や 32 など月の範囲外でも、Date.UTC と同じように暦を繰り上げ/繰り下げて扱う
 * （不在シミュレーションで「前日」「翌日」の日時を計算するため）。
 *
 * オフセット（タイムゾーンと UTC の差）は「壁時計の値をそのまま UTC とみなした仮の値」から
 * 求め、DST の切り替わり（オフセットが変わる瞬間）に備えて2回補正する。
 */
export function localTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  // 壁時計の値をそのまま UTC の ms 値として表したもの（目標値）
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // 1回目: オフセットが0だと仮定した瞬間から実際のオフセットを求めて補正
  let instant = target - getOffsetMs(new Date(target), timeZone);
  // 2回目: DST の切り替わりなどでオフセットが変わっている場合に備えて再補正
  instant = target - getOffsetMs(new Date(instant), timeZone);

  return new Date(instant);
}
