import { describe, it, expect } from "vitest";
import {
  formatAbsenceRecordForPrompt,
  formatAbsenceRecordAsInputText,
} from "../../../src/lib/absenceRecordText.js";
import type { AbsenceRecord } from "../../../src/types.js";

function baseRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-09-19T00:00:00.000Z",
    startDatetime: "2026-09-18T13:00:00.000Z", // 2026/09/18 22:00 JST
    endDatetime: "2026-09-19T01:00:00.000Z", // 2026/09/19 10:00 JST
    events: [],
    actions: [],
    threads: [],
    ...overrides,
  };
}

describe("formatAbsenceRecordForPrompt", () => {
  describe("periodText", () => {
    it("Asia/Tokyoを渡す → startDatetime〜endDatetimeがUTCから変換されて表記される", () => {
      const { periodText } = formatAbsenceRecordForPrompt(baseRecord(), "Asia/Tokyo");

      expect(periodText).toBe("2026/09/18(金) 22:00 〜 2026/09/19(土) 10:00");
    });

    it("日付をまたぐ期間 → 開始・終了それぞれの日付が別々に表記される", () => {
      const record = baseRecord({
        startDatetime: "2026-09-18T13:00:00.000Z", // 09/18 22:00 JST
        endDatetime: "2026-09-19T01:00:00.000Z", // 09/19 10:00 JST
      });

      const { periodText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(periodText).toContain("2026/09/18(金)");
      expect(periodText).toContain("2026/09/19(土)");
    });

    it("America/New_Yorkを渡す → Asia/Tokyoとは異なる時刻が表記される", () => {
      const record = baseRecord();

      const tokyo = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");
      const newYork = formatAbsenceRecordForPrompt(record, "America/New_York");

      expect(newYork.periodText).not.toBe(tokyo.periodText);
      expect(newYork.periodText).toBe("2026/09/18(金) 09:00 〜 2026/09/18(金) 21:00");
    });
  });

  describe("eventsText", () => {
    it("出来事が1件 → 「1. summary」と次の行に半角スペース3つ字下げのdetailになる", () => {
      const record = baseRecord({
        events: [
          {
            kind: "daily",
            summary: "配信の準備をした",
            detail: "新しい衣装のチェックをしていた",
            threadId: "thread-1",
          },
        ],
      });

      const { eventsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(eventsText).toBe("1. 配信の準備をした\n   新しい衣装のチェックをしていた");
    });

    it("出来事が複数件 → 番号が振られ、出来事の間に改行1つが入る", () => {
      const record = baseRecord({
        events: [
          { kind: "daily", summary: "買い物に行った", detail: "スーパーで食材を買った" },
          { kind: "hobby", summary: "ゲームをした", detail: "新作RPGを少し進めた" },
        ],
      });

      const { eventsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(eventsText).toBe(
        "1. 買い物に行った\n   スーパーで食材を買った\n2. ゲームをした\n   新作RPGを少し進めた"
      );
    });

    it("kindとthreadIdが出力に含まれない", () => {
      const record = baseRecord({
        events: [
          {
            kind: "special_kind_label",
            summary: "特別な出来事があった",
            detail: "詳細な説明",
            threadId: "thread-xyz",
          },
        ],
      });

      const { eventsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(eventsText).not.toContain("special_kind_label");
      expect(eventsText).not.toContain("thread-xyz");
    });

    it("出来事が0件 → 「（なし）」になる", () => {
      const record = baseRecord({ events: [] });

      const { eventsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(eventsText).toBe("（なし）");
    });
  });

  describe("actionsText", () => {
    it("memoがある行動 → 「・開始〜終了 action（memo）」になる", () => {
      const record = baseRecord({
        actions: [
          {
            startDatetime: "2026-09-18T13:00:00.000Z", // 22:00 JST
            endDatetime: "2026-09-18T14:00:00.000Z", // 23:00 JST
            action: "夕食を食べた",
            memo: "カレーライスだった",
          },
        ],
      });

      const { actionsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(actionsText).toBe(
        "・2026/09/18(金) 22:00〜2026/09/18(金) 23:00 夕食を食べた（カレーライスだった）"
      );
    });

    it("memoが空文字の行動 → 末尾に（）が付かない", () => {
      const record = baseRecord({
        actions: [
          {
            startDatetime: "2026-09-18T13:00:00.000Z",
            endDatetime: "2026-09-18T14:00:00.000Z",
            action: "入浴した",
            memo: "",
          },
        ],
      });

      const { actionsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(actionsText).toBe("・2026/09/18(金) 22:00〜2026/09/18(金) 23:00 入浴した");
    });

    it("行動が複数件 → 1行ずつ改行区切りになる", () => {
      const record = baseRecord({
        actions: [
          {
            startDatetime: "2026-09-18T13:00:00.000Z",
            endDatetime: "2026-09-18T14:00:00.000Z",
            action: "入浴した",
            memo: "",
          },
          {
            startDatetime: "2026-09-18T14:00:00.000Z",
            endDatetime: "2026-09-18T15:00:00.000Z",
            action: "読書をした",
            memo: "",
          },
        ],
      });

      const { actionsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(actionsText.split("\n")).toHaveLength(2);
    });

    it("行動が0件 → 「（なし）」になる", () => {
      const record = baseRecord({ actions: [] });

      const { actionsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(actionsText).toBe("（なし）");
    });
  });

  describe("openThreadsText", () => {
    it("statusがopenの話題 → 「・topic」で出力される", () => {
      const record = baseRecord({
        threads: [{ id: "thread-1", topic: "新しいゲームの話", status: "open", openedAt: "2026-09-18T13:00:00.000Z" }],
      });

      const { openThreadsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(openThreadsText).toBe("・新しいゲームの話");
    });

    it("statusがclosedの話題は出力されない", () => {
      const record = baseRecord({
        threads: [
          { id: "thread-1", topic: "終わった話題", status: "closed", openedAt: "2026-09-18T13:00:00.000Z" },
          { id: "thread-2", topic: "続いている話題", status: "open", openedAt: "2026-09-18T13:00:00.000Z" },
        ],
      });

      const { openThreadsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(openThreadsText).toBe("・続いている話題");
    });

    it("idとopenedAtが出力に含まれない", () => {
      const record = baseRecord({
        threads: [
          {
            id: "thread-unique-id",
            topic: "話題",
            status: "open",
            openedAt: "2026-09-18T13:00:00.000Z",
          },
        ],
      });

      const { openThreadsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(openThreadsText).not.toContain("thread-unique-id");
      expect(openThreadsText).not.toContain("2026-09-18T13:00:00.000Z");
    });

    it("openの話題が0件（全てclosed、または話題自体が無い） → 「（なし）」になる", () => {
      const record = baseRecord({
        threads: [{ id: "thread-1", topic: "終わった話題", status: "closed", openedAt: "2026-09-18T13:00:00.000Z" }],
      });

      const { openThreadsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

      expect(openThreadsText).toBe("（なし）");
    });
  });

  it("summary/detail/action/memo/topicに含まれる「/」がエスケープされず素の文字で出力される", () => {
    const record = baseRecord({
      events: [{ kind: "daily", summary: "AM/PMの配信をした", detail: "12/25の予定を話した" }],
      actions: [
        {
          startDatetime: "2026-09-18T13:00:00.000Z",
          endDatetime: "2026-09-18T14:00:00.000Z",
          action: "1/2の時間だけ休憩した",
          memo: "on/offの切り替え",
        },
      ],
      threads: [{ id: "thread-1", topic: "配信/雑談の話題", status: "open", openedAt: "2026-09-18T13:00:00.000Z" }],
    });

    const { eventsText, actionsText, openThreadsText } = formatAbsenceRecordForPrompt(record, "Asia/Tokyo");

    expect(eventsText).toContain("AM/PMの配信をした");
    expect(eventsText).toContain("12/25の予定を話した");
    expect(actionsText).toContain("1/2の時間だけ休憩した");
    expect(actionsText).toContain("on/offの切り替え");
    expect(openThreadsText).toContain("配信/雑談の話題");
  });
});

describe("formatAbsenceRecordAsInputText", () => {
  it("出来事・行動がある → 【不在中の出来事】（期間: …）・【不在中の行動】の形にまとめられる", () => {
    const record = baseRecord({
      events: [{ kind: "daily", summary: "配信の準備をした", detail: "新しい衣装のチェックをしていた" }],
      actions: [
        {
          startDatetime: "2026-09-18T13:00:00.000Z",
          endDatetime: "2026-09-18T14:00:00.000Z",
          action: "夕食を食べた",
          memo: "カレーライスだった",
        },
      ],
    });

    const inputText = formatAbsenceRecordAsInputText(record, "Asia/Tokyo");

    expect(inputText).toBe(
      "【不在中の出来事】（期間: 2026/09/18(金) 22:00 〜 2026/09/19(土) 10:00）\n" +
        "1. 配信の準備をした\n   新しい衣装のチェックをしていた\n\n" +
        "【不在中の行動】\n" +
        "・2026/09/18(金) 22:00〜2026/09/18(金) 23:00 夕食を食べた（カレーライスだった）"
    );
  });

  it("出来事・行動が0件 → それぞれ「（なし）」になる", () => {
    const record = baseRecord({ events: [], actions: [] });

    const inputText = formatAbsenceRecordAsInputText(record, "Asia/Tokyo");

    expect(inputText).toBe(
      "【不在中の出来事】（期間: 2026/09/18(金) 22:00 〜 2026/09/19(土) 10:00）\n（なし）\n\n【不在中の行動】\n（なし）"
    );
  });
});
