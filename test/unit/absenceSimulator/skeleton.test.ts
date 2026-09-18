import { describe, it, expect, vi } from "vitest";
import { buildAbsenceSkeleton, MAX_ACTION_WINDOW_HOURS } from "../../../src/absenceSimulator/skeleton.js";
import type { Lifestyle } from "../../../src/types.js";

const TIME_ZONE = "Asia/Tokyo";

// 就寝(23:00〜07:00)を含む、日をまたぐ枠を持つ生活様式。
// 2026-09-18は金曜、9/19は土曜、9/20は日曜、9/21は月曜。
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
  eventKinds: [
    { key: "daily", label: "日常のひとコマ", weight: 4 },
    { key: "small-joy", label: "ちょっと嬉しいこと", weight: 2 },
  ],
};

describe("buildAbsenceSkeleton", () => {
  it("不在3時間 → 行動の枠は3時間分（今回ログインまでの直近）、出来事は1件", () => {
    // 火曜07:00〜10:00 JST（学校の枠の一部）。3時間の不在。
    const lastLoginAt = new Date("2026-09-21T22:00:00.000Z"); // 火曜07:00 JST
    const now = new Date("2026-09-22T01:00:00.000Z"); // 火曜10:00 JST

    vi.spyOn(Math, "random").mockReturnValue(0); // 常に先頭(daily)が選ばれる

    const result = buildAbsenceSkeleton({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      lastLoginAt,
      now,
    });

    expect(result.startDatetime).toBe(lastLoginAt.toISOString());
    expect(result.endDatetime).toBe(now.toISOString());
    expect(result.actionSlots).toEqual([
      {
        startDatetime: lastLoginAt.toISOString(),
        endDatetime: iso("2026-09-21T23:00:00.000Z"), // 火曜08:00 JST（起床→学校の境目）
        activity: "起床",
      },
      {
        startDatetime: iso("2026-09-21T23:00:00.000Z"),
        endDatetime: now.toISOString(),
        activity: "学校",
      },
    ]);
    expect(result.eventKinds).toHaveLength(1);
    expect(result.eventKinds[0].key).toBe("daily");
  });

  it("不在30時間 → 行動の枠の範囲は直近12時間(MAX_ACTION_WINDOW_HOURS)に収まり、出来事は3件", () => {
    expect(MAX_ACTION_WINDOW_HOURS).toBe(12);

    const now = new Date("2026-09-22T01:00:00.000Z"); // 火曜10:00 JST
    const lastLoginAt = new Date(now.getTime() - 30 * 60 * 60 * 1000); // 30時間前

    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = buildAbsenceSkeleton({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      lastLoginAt,
      now,
    });

    // 行動の枠は now までの直近12時間だけを対象にするので、lastLoginAt(30時間前)より後になる
    const windowStartMs = now.getTime() - MAX_ACTION_WINDOW_HOURS * 60 * 60 * 1000;
    for (const slot of result.actionSlots) {
      expect(new Date(slot.startDatetime).getTime()).toBeGreaterThanOrEqual(windowStartMs);
      expect(new Date(slot.endDatetime).getTime()).toBeLessThanOrEqual(now.getTime());
    }
    expect(result.actionSlots.length).toBeGreaterThan(0);

    // 出来事の件数は不在時間全体（30時間）で決まる: 1 + floor(30/12) = 3
    expect(result.eventKinds).toHaveLength(3);

    // start/end はそのまま入力どおり
    expect(result.startDatetime).toBe(lastLoginAt.toISOString());
    expect(result.endDatetime).toBe(now.toISOString());
  });

  it("nowがlastLoginAtより前 → 行動の枠も出来事も空で、start/endはそのまま返る", () => {
    const lastLoginAt = new Date("2026-09-22T01:00:00.000Z");
    const now = new Date("2026-09-21T22:00:00.000Z"); // lastLoginAtより3時間前

    const result = buildAbsenceSkeleton({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      lastLoginAt,
      now,
    });

    expect(result.actionSlots).toEqual([]);
    expect(result.eventKinds).toEqual([]);
    expect(result.startDatetime).toBe(lastLoginAt.toISOString());
    expect(result.endDatetime).toBe(now.toISOString());
  });

  it("startDatetime/endDatetimeが入力どおりのISO文字列になること", () => {
    const lastLoginAt = new Date("2026-09-18T00:00:00.000Z");
    const now = new Date("2026-09-18T03:30:00.000Z");

    const result = buildAbsenceSkeleton({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      lastLoginAt,
      now,
    });

    expect(result.startDatetime).toBe("2026-09-18T00:00:00.000Z");
    expect(result.endDatetime).toBe("2026-09-18T03:30:00.000Z");
  });

  it("抽選された種類がMath.randomの値に応じて変わること", () => {
    const lastLoginAt = new Date("2026-09-21T22:00:00.000Z");
    const now = new Date("2026-09-22T01:00:00.000Z"); // 3時間 → 出来事1件

    vi.spyOn(Math, "random").mockReturnValue(0.9999999999); // 累積和の末尾側(small-joy)が選ばれる
    const result = buildAbsenceSkeleton({
      lifestyle: testLifestyle,
      timeZone: TIME_ZONE,
      lastLoginAt,
      now,
    });

    expect(result.eventKinds).toHaveLength(1);
    expect(result.eventKinds[0].key).toBe("small-joy");
  });
});

function iso(utcString: string): string {
  return new Date(utcString).toISOString();
}
