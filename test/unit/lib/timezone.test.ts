import { describe, it, expect } from "vitest";
import { getLocalParts, localTimeToInstant } from "../../../src/lib/timezone.js";

describe("getLocalParts", () => {
  it("Asia/TokyoでUTC 2026-09-18T15:00Zを渡す → JSTで翌日0:00・土曜になる", () => {
    const parts = getLocalParts(new Date("2026-09-18T15:00:00.000Z"), "Asia/Tokyo");

    expect(parts).toEqual({
      year: 2026,
      month: 9,
      day: 19,
      hour: 0,
      minute: 0,
      weekday: 6, // 土曜
    });
  });

  it("Asia/Tokyoで平日の日時を渡す → 曜日が正しく求まる（2026-09-18は金曜）", () => {
    const parts = getLocalParts(new Date("2026-09-18T01:00:00.000Z"), "Asia/Tokyo");

    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(9);
    expect(parts.day).toBe(18);
    expect(parts.weekday).toBe(5); // 金曜
  });

  it("Asia/Tokyoで日曜0:00ちょうどを渡す → weekdayが0になる", () => {
    // 2026-09-20 00:00 JST = 2026-09-19 15:00 UTC
    const parts = getLocalParts(new Date("2026-09-19T15:00:00.000Z"), "Asia/Tokyo");

    expect(parts.day).toBe(20);
    expect(parts.weekday).toBe(0); // 日曜
  });
});

describe("localTimeToInstant", () => {
  it("Asia/TokyoでJST 07:00を渡す → UTCの前日22:00になる", () => {
    const instant = localTimeToInstant(2026, 9, 19, 7, 0, "Asia/Tokyo");

    expect(instant.toISOString()).toBe("2026-09-18T22:00:00.000Z");
  });

  it("dayが月の範囲外（1/31の翌日=32） → 2/1として扱われる", () => {
    const overflowed = localTimeToInstant(2026, 1, 32, 7, 0, "Asia/Tokyo");
    const expected = localTimeToInstant(2026, 2, 1, 7, 0, "Asia/Tokyo");

    expect(overflowed.getTime()).toBe(expected.getTime());
  });

  it("dayが0（前日） → 前月末日として扱われる", () => {
    const underflowed = localTimeToInstant(2026, 1, 0, 7, 0, "Asia/Tokyo");
    const expected = localTimeToInstant(2025, 12, 31, 7, 0, "Asia/Tokyo");

    expect(underflowed.getTime()).toBe(expected.getTime());
  });

  it("年末をまたぐ繰り上がり（12月32日） → 翌年1月1日として扱われる", () => {
    const overflowed = localTimeToInstant(2026, 12, 32, 0, 0, "Asia/Tokyo");
    const expected = localTimeToInstant(2027, 1, 1, 0, 0, "Asia/Tokyo");

    expect(overflowed.getTime()).toBe(expected.getTime());
  });

  it("Asia/Tokyoで往復変換する → getLocalPartsで元の壁時計の値に戻る", () => {
    const instant = localTimeToInstant(2026, 9, 21, 13, 45, "Asia/Tokyo");
    const parts = getLocalParts(instant, "Asia/Tokyo");

    expect(parts).toEqual({
      year: 2026,
      month: 9,
      day: 21,
      hour: 13,
      minute: 45,
      weekday: 1, // 月曜
    });
  });

  it("DSTのあるタイムゾーン（America/New_York）で冬時間の時刻を渡す → EST(UTC-5)として変換される", () => {
    const instant = localTimeToInstant(2026, 1, 15, 7, 0, "America/New_York");

    expect(instant.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("DSTのあるタイムゾーン（America/New_York）で夏時間の時刻を渡す → EDT(UTC-4)として変換される", () => {
    const instant = localTimeToInstant(2026, 7, 15, 7, 0, "America/New_York");

    expect(instant.toISOString()).toBe("2026-07-15T11:00:00.000Z");
  });
});
