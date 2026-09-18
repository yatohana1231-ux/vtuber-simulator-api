import { describe, it, expect } from "vitest";
import { buildActionSlots, MIN_SLOT_MINUTES } from "../../../src/absenceSimulator/actionSlots.js";
import { loadPackage, DEFAULT_PACKAGE_ID } from "../../../src/lib/packages.js";
import type { Lifestyle } from "../../../src/types.js";

const TIME_ZONE = "Asia/Tokyo";

// テスト用の生活様式。就寝は日をまたぐ枠（end <= start）にしてある。
// 2026-09-18は金曜、9/19は土曜、9/20は日曜、9/21は月曜、9/22は火曜、9/23は水曜。
const testLifestyle: Lifestyle = {
  key: "test-lifestyle",
  schedules: {
    weekday: [
      { start: "07:00", end: "08:00", activity: "起床" },
      { start: "08:00", end: "17:00", activity: "学校" },
      { start: "23:00", end: "07:00", activity: "就寝" },
    ],
    holiday: [
      { start: "08:00", end: "09:00", activity: "起床（休日）" },
      { start: "23:00", end: "08:00", activity: "就寝（休日）" },
    ],
  },
  eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
};

function iso(utcString: string): string {
  return new Date(utcString).toISOString();
}

describe("buildActionSlots", () => {
  it("windowEnd <= windowStart → 空配列", () => {
    const windowStart = new Date("2026-09-22T00:00:00.000Z");
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart,
      windowEnd: windowStart, // 同時刻
    });

    expect(result).toEqual([]);
  });

  it("平日だけの期間（火曜07:00〜水曜07:00） → 平日の枠がそのまま並ぶ", () => {
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-21T22:00:00.000Z"), // 火曜07:00 JST
      windowEnd: new Date("2026-09-22T22:00:00.000Z"), // 水曜07:00 JST
    });

    expect(result).toEqual([
      {
        startDatetime: iso("2026-09-21T22:00:00.000Z"),
        endDatetime: iso("2026-09-21T23:00:00.000Z"),
        activity: "起床",
      },
      {
        startDatetime: iso("2026-09-21T23:00:00.000Z"),
        endDatetime: iso("2026-09-22T08:00:00.000Z"),
        activity: "学校",
      },
      {
        startDatetime: iso("2026-09-22T14:00:00.000Z"),
        endDatetime: iso("2026-09-22T22:00:00.000Z"),
        activity: "就寝",
      },
    ]);
  });

  it("平日→休日（金曜夜〜土曜朝） → 就寝の後、休日の起床までの間が空く", () => {
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-18T11:00:00.000Z"), // 金曜20:00 JST
      windowEnd: new Date("2026-09-19T01:00:00.000Z"), // 土曜10:00 JST
    });

    expect(result).toEqual([
      {
        startDatetime: iso("2026-09-18T14:00:00.000Z"), // 金曜23:00 JST
        endDatetime: iso("2026-09-18T22:00:00.000Z"), // 土曜07:00 JST
        activity: "就寝",
      },
      {
        startDatetime: iso("2026-09-18T23:00:00.000Z"), // 土曜08:00 JST
        endDatetime: iso("2026-09-19T00:00:00.000Z"), // 土曜09:00 JST
        activity: "起床（休日）",
      },
    ]);
    // 就寝の終了(07:00)と起床（休日）の開始(08:00)の間、1時間空いている
    expect(new Date(result[1].startDatetime).getTime()).toBeGreaterThan(
      new Date(result[0].endDatetime).getTime()
    );
  });

  it("休日→平日（日曜夜〜月曜朝） → 休日の就寝が月曜の起床の時刻に切り詰められる", () => {
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-20T13:00:00.000Z"), // 日曜22:00 JST
      windowEnd: new Date("2026-09-21T00:00:00.000Z"), // 月曜09:00 JST
    });

    expect(result).toEqual([
      {
        startDatetime: iso("2026-09-20T14:00:00.000Z"), // 日曜23:00 JST
        endDatetime: iso("2026-09-20T22:00:00.000Z"), // 月曜07:00 JST（本来は08:00だが切り詰められる）
        activity: "就寝（休日）",
      },
      {
        startDatetime: iso("2026-09-20T22:00:00.000Z"), // 月曜07:00 JST
        endDatetime: iso("2026-09-20T23:00:00.000Z"), // 月曜08:00 JST
        activity: "起床",
      },
      {
        startDatetime: iso("2026-09-20T23:00:00.000Z"), // 月曜08:00 JST
        endDatetime: iso("2026-09-21T00:00:00.000Z"), // 月曜09:00 JST（学校の枠が期間の端で切り詰められる）
        activity: "学校",
      },
    ]);
  });

  it("前日から続く日をまたぐ枠が期間の先頭で切り詰められて入ること", () => {
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-21T18:00:00.000Z"), // 火曜03:00 JST（月曜夜の就寝の途中）
      windowEnd: new Date("2026-09-21T20:00:00.000Z"), // 火曜05:00 JST
    });

    expect(result).toEqual([
      {
        startDatetime: iso("2026-09-21T18:00:00.000Z"),
        endDatetime: iso("2026-09-21T20:00:00.000Z"),
        activity: "就寝",
      },
    ]);
  });

  it("期間の端で15分未満になった枠は捨てられる", () => {
    // 火曜06:50〜07:10 JST: 就寝の末尾(〜07:00)と起床の先頭(07:00〜)、
    // どちらも重なりが10分だけになり、MIN_SLOT_MINUTES(15分)未満なので両方捨てられる
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-21T21:50:00.000Z"),
      windowEnd: new Date("2026-09-21T22:10:00.000Z"),
    });

    expect(MIN_SLOT_MINUTES).toBe(15);
    expect(result).toEqual([]);
  });

  it("戻り値が開始時刻の昇順で、隣り合う枠が重ならないこと", () => {
    const result = buildActionSlots({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      windowStart: new Date("2026-09-18T11:00:00.000Z"), // 金曜20:00 JST
      windowEnd: new Date("2026-09-21T00:00:00.000Z"), // 月曜09:00 JST
    });

    expect(result.length).toBeGreaterThan(1);
    for (let i = 0; i < result.length - 1; i++) {
      const currentEnd = new Date(result[i].endDatetime).getTime();
      const nextStart = new Date(result[i + 1].startDatetime).getTime();
      expect(currentEnd).toBeLessThanOrEqual(nextStart);
    }
  });

  it("本物のtokyo-highschool-vtuberパッケージで12時間の期間を展開する → 全枠が期間内に収まり重ならない", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    expect(pkg).not.toBeNull();

    const windowStart = new Date("2026-09-18T00:00:00.000Z"); // 金曜09:00 JST
    const windowEnd = new Date("2026-09-18T12:00:00.000Z"); // 金曜21:00 JST

    const result = buildActionSlots({
      lifestyle: pkg!.lifestyle,
      timeZone: pkg!.world.timezone,
      windowStart,
      windowEnd,
    });

    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      const start = new Date(slot.startDatetime).getTime();
      const end = new Date(slot.endDatetime).getTime();
      expect(start).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(end).toBeLessThanOrEqual(windowEnd.getTime());
      expect(start).toBeLessThan(end);
    }
    for (let i = 0; i < result.length - 1; i++) {
      const currentEnd = new Date(result[i].endDatetime).getTime();
      const nextStart = new Date(result[i + 1].startDatetime).getTime();
      expect(currentEnd).toBeLessThanOrEqual(nextStart);
    }
  });
});
