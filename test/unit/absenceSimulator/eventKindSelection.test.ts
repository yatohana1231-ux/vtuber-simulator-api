import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_EVENTS,
  countEvents,
  pickEventKinds,
} from "../../../src/absenceSimulator/eventKindSelection.js";
import type { EventKind } from "../../../src/types.js";

const HOUR_MS = 60 * 60 * 1000;

describe("countEvents", () => {
  it("elapsedMsが0 → 0件になる", () => {
    expect(countEvents(0)).toBe(0);
  });

  it("elapsedMsが負の値 → 0件になる", () => {
    expect(countEvents(-1)).toBe(0);
  });

  it("elapsedMsが1ミリ秒 → 1件になる", () => {
    expect(countEvents(1)).toBe(1);
  });

  it("経過時間が3時間 → 1件になる", () => {
    expect(countEvents(3 * HOUR_MS)).toBe(1);
  });

  it("経過時間が11時間59分 → 1件になる", () => {
    expect(countEvents(11 * HOUR_MS + 59 * 60 * 1000)).toBe(1);
  });

  it("経過時間が12時間 → 2件になる", () => {
    expect(countEvents(12 * HOUR_MS)).toBe(2);
  });

  it("経過時間が24時間 → 3件になる", () => {
    expect(countEvents(24 * HOUR_MS)).toBe(3);
  });

  it("経過時間が36時間 → 4件になる", () => {
    expect(countEvents(36 * HOUR_MS)).toBe(4);
  });

  it("経過時間が48時間 → 5件になる", () => {
    expect(countEvents(48 * HOUR_MS)).toBe(5);
  });

  it("経過時間が1週間 → 上限のMAX_EVENTS件になる", () => {
    expect(countEvents(7 * 24 * HOUR_MS)).toBe(MAX_EVENTS);
    expect(countEvents(7 * 24 * HOUR_MS)).toBe(5);
  });
});

describe("pickEventKinds", () => {
  const eventKinds: EventKind[] = [
    { key: "daily", label: "日常のひとコマ", weight: 4 },
    { key: "small-joy", label: "ちょっと嬉しいこと", weight: 2 },
    { key: "small-trouble", label: "ちょっとしたトラブルや失敗", weight: 2 },
    { key: "discovery", label: "新しい発見や、はじめての体験", weight: 1 },
  ];

  it("countが0 → 空配列を返す", () => {
    expect(pickEventKinds(eventKinds, 0)).toEqual([]);
  });

  it("countが負の値 → 空配列を返す", () => {
    expect(pickEventKinds(eventKinds, -1)).toEqual([]);
  });

  it("count件を渡す → count件の配列を返す", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickEventKinds(eventKinds, 3)).toHaveLength(3);
  });

  it("Math.randomの値に応じた種類が選ばれる（同じ種類が複数回選ばれてもよい）", () => {
    // 合計9。0を返す限り毎回先頭（daily）が選ばれる。
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = pickEventKinds(eventKinds, 3);
    expect(result.map((k) => k.key)).toEqual(["daily", "daily", "daily"]);
  });

  it("Math.randomの値が変わると選ばれる種類も変わる", () => {
    // 累積和: daily=4, small-joy=6, small-trouble=8, discovery=9
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0) // 0*9=0 → daily
      .mockReturnValueOnce(0.5) // 0.5*9=4.5 → small-joy
      .mockReturnValueOnce(0.9999999999); // ほぼ9 → discovery
    const result = pickEventKinds(eventKinds, 3);
    expect(result.map((k) => k.key)).toEqual([
      "daily",
      "small-joy",
      "discovery",
    ]);
  });

  it("実際のtokyo-highschool-vtuberのeventKindsを渡しても動く", () => {
    const contentPath = fileURLToPath(
      new URL(
        "../../../content/lifestyles/tokyo-highschool-vtuber.json",
        import.meta.url
      )
    );
    const lifestyle = JSON.parse(readFileSync(contentPath, "utf-8")) as {
      eventKinds: EventKind[];
    };

    vi.spyOn(Math, "random").mockReturnValue(0.3);
    const result = pickEventKinds(lifestyle.eventKinds, 5);
    expect(result).toHaveLength(5);
    for (const kind of result) {
      expect(lifestyle.eventKinds.map((k) => k.key)).toContain(kind.key);
    }
  });
});
