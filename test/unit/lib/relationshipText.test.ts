import { describe, it, expect } from "vitest";
import { formatRelationshipHistoryForPrompt } from "../../../src/lib/relationshipText.js";
import type { RelationshipRecord } from "../../../src/types.js";

const TZ = "Asia/Tokyo";

function baseRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    firstMetAt: "2026-08-28T03:00:00.000Z", // JST 2026-08-28 12:00
    lastConversationAt: "2026-09-16T03:00:00.000Z", // JST 2026-09-16 12:00
    lastConversationDate: "2026-09-16",
    conversationCount: 120,
    conversationDays: 15,
    stageKey: "close",
    highestStageKey: "close",
    recoveryRemaining: 0,
    lastDemotedAt: null,
    updatedAt: "2026-09-16T03:00:00.000Z",
    ...overrides,
  };
}

describe("formatRelationshipHistoryForPrompt", () => {
  it("ロードマップの例の形 → 「出会ってからN日目。話した日はN日、会話はN回。最後に話したのはN日前。」", () => {
    const now = new Date("2026-09-19T03:00:00.000Z"); // JST 2026-09-19 12:00

    const text = formatRelationshipHistoryForPrompt(baseRecord(), now, TZ);

    expect(text).toBe("出会ってから23日目。話した日は15日、会話は120回。最後に話したのは3日前。");
  });

  describe("最後に話した日の表記", () => {
    it("今日話した（同じ暦日） → 「今日」", () => {
      const now = new Date("2026-09-16T10:00:00.000Z"); // JST 09-16、lastConversationAtと同じ暦日
      const record = baseRecord({ lastConversationAt: "2026-09-16T03:00:00.000Z" });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toContain("最後に話したのは今日。");
    });

    it("昨日話した → 「昨日」", () => {
      const now = new Date("2026-09-17T03:00:00.000Z"); // JST 09-17
      const record = baseRecord({ lastConversationAt: "2026-09-16T03:00:00.000Z" }); // JST 09-16

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toContain("最後に話したのは昨日。");
    });

    it("3日前に話した → 「3日前」", () => {
      const now = new Date("2026-09-19T03:00:00.000Z");
      const record = baseRecord({ lastConversationAt: "2026-09-16T03:00:00.000Z" });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toContain("最後に話したのは3日前。");
    });
  });

  describe("まだ発言が無いとき（lastConversationAt が null）", () => {
    it("出会った日が今日 → 「今日はじめて会った。」だけになる", () => {
      const now = new Date("2026-09-19T03:00:00.000Z"); // JST 09-19
      const record = baseRecord({
        firstMetAt: "2026-09-19T01:00:00.000Z", // JST 09-19（今日）
        lastConversationAt: null,
        lastConversationDate: null,
        conversationCount: 0,
        conversationDays: 0,
      });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toBe("今日はじめて会った。");
    });

    it("出会った日が今日でない → 「出会ってからN日目。まだちゃんと話したことはない。」になり、回数の文が省かれる", () => {
      const now = new Date("2026-09-19T03:00:00.000Z"); // JST 09-19
      const record = baseRecord({
        firstMetAt: "2026-09-17T03:00:00.000Z", // JST 09-17（2日前 → 3日目）
        lastConversationAt: null,
        lastConversationDate: null,
        conversationCount: 0,
        conversationDays: 0,
      });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toBe("出会ってから3日目。まだちゃんと話したことはない。");
      expect(text).not.toContain("話した日は");
      expect(text).not.toContain("会話は");
    });
  });

  describe("日付の境界（Asia/Tokyo）", () => {
    it("実時間では1時間程度の差でも、タイムゾーンの暦日をまたぐと出会った日数が変わる", () => {
      // now: JST 2026-09-19 00:00（日付が変わった直後）
      const now = new Date("2026-09-18T15:00:00.000Z");
      // firstMetAt: JST 2026-09-18 23:00（1時間前だが、暦日はnowの前日）
      const record = baseRecord({
        firstMetAt: "2026-09-18T14:00:00.000Z",
        lastConversationAt: null,
        lastConversationDate: null,
        conversationCount: 0,
        conversationDays: 0,
      });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      // 出会った日（前日）を1日目として数えるので2日目になる
      expect(text).toBe("出会ってから2日目。まだちゃんと話したことはない。");
    });

    it("最後に話した日が暦日の境界をまたぐと「今日」ではなく「昨日」になる", () => {
      // now: JST 2026-09-19 00:30
      const now = new Date("2026-09-18T15:30:00.000Z");
      // lastConversationAt: JST 2026-09-18 23:30（1時間前だが、暦日はnowの前日）
      const record = baseRecord({ lastConversationAt: "2026-09-18T14:30:00.000Z" });

      const text = formatRelationshipHistoryForPrompt(record, now, TZ);

      expect(text).toContain("最後に話したのは昨日。");
    });
  });
});
