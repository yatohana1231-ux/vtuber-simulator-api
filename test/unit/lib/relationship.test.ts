import { describe, it, expect } from "vitest";
import {
  advanceRelationship,
  DEMOTE_AFTER_DAYS,
  RECOVERY_MESSAGES,
} from "../../../src/lib/relationship.js";
import type { Perception, RelationshipRecord, RelationshipStage } from "../../../src/types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TZ = "Asia/Tokyo";

const STAGES: RelationshipStage[] = [
  {
    key: "first",
    label: "はじめまして",
    description: "初対面",
    speechStyle: "丁寧語",
    speechExamples: [],
    promoteWhen: null,
  },
  {
    key: "acquainted",
    label: "顔なじみ",
    description: "顔見知り",
    speechStyle: "ときどきくだける",
    speechExamples: [],
    promoteWhen: { minConversationDays: 3, minConversationCount: 5, minPerception: { familiarity: 45 } },
  },
  {
    key: "close",
    label: "仲良し",
    description: "仲が良い",
    speechStyle: "タメ口",
    speechExamples: [],
    promoteWhen: {
      minConversationDays: 10,
      minConversationCount: 20,
      minPerception: { familiarity: 65, trust: 60 },
    },
  },
  {
    key: "special",
    label: "特別な存在",
    description: "特別",
    speechStyle: "素を見せる",
    speechExamples: [],
    promoteWhen: {
      minConversationDays: 30,
      minConversationCount: 50,
      minPerception: { familiarity: 80, trust: 75, affection: 70 },
    },
  },
];

function perception(overrides: Partial<Perception> = {}): Perception {
  return {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 10,
    dependence: 10,
    familiarity: 50,
    ...overrides,
  };
}

function record(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
  return {
    firstMetAt: "2026-08-01T00:00:00.000Z",
    lastConversationAt: "2026-09-01T00:00:00.000Z",
    lastConversationDate: "2026-09-01",
    conversationCount: 10,
    conversationDays: 5,
    stageKey: "acquainted",
    highestStageKey: "acquainted",
    recoveryRemaining: 0,
    lastDemotedAt: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("advanceRelationship", () => {
  describe("はじめての呼び出し（record が null）", () => {
    it("ログイン時の挨拶（isPlayerMessage: false） → 最初の段階から始まり、履歴は0のまま", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");

      const { record: result, milestones } = advanceRelationship({
        record: null,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(result.firstMetAt).toBe(now.toISOString());
      expect(result.stageKey).toBe("first");
      expect(result.highestStageKey).toBe("first");
      expect(result.conversationCount).toBe(0);
      expect(result.conversationDays).toBe(0);
      expect(result.lastConversationAt).toBeNull();
      expect(result.lastConversationDate).toBeNull();
      expect(result.lastDemotedAt).toBeNull();
      expect(result.recoveryRemaining).toBe(0);
      expect(result.updatedAt).toBe(now.toISOString());
      expect(milestones).toEqual([]);
    });

    it("プレイヤーの発言（isPlayerMessage: true） → firstMetAtを設定したうえで発言も1回として数える", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");

      const { record: result } = advanceRelationship({
        record: null,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.firstMetAt).toBe(now.toISOString());
      expect(result.conversationCount).toBe(1);
      expect(result.conversationDays).toBe(1);
      expect(result.lastConversationAt).toBe(now.toISOString());
    });
  });

  describe("発言あり/なし", () => {
    it("isPlayerMessage: false（ログイン時の挨拶） → conversationCount/Daysが変わらない", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");
      const before = record({ conversationCount: 10, conversationDays: 5, lastConversationDate: "2026-09-01" });

      const { record: result } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(result.conversationCount).toBe(10);
      expect(result.conversationDays).toBe(5);
      expect(result.lastConversationAt).toBe(before.lastConversationAt);
      expect(result.lastConversationDate).toBe("2026-09-01");
    });

    it("isPlayerMessage: true → conversationCountが1増え、lastConversationAtが更新される", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");
      const before = record({ conversationCount: 10, conversationDays: 5, lastConversationDate: "2026-09-19" });

      const { record: result } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.conversationCount).toBe(11);
      expect(result.lastConversationAt).toBe(now.toISOString());
    });
  });

  describe("日付の変わり目（Asia/Tokyo）", () => {
    it("世界観のタイムゾーンで日付が変わる瞬間 → conversationDaysが1増え、lastConversationDateが更新される", () => {
      // 2026-09-18T15:00:00Z は JST で 2026-09-19 00:00（日付が変わった直後）
      const now = new Date("2026-09-18T15:00:00.000Z");
      const before = record({ conversationDays: 5, lastConversationDate: "2026-09-18" });

      const { record: result } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.conversationDays).toBe(6);
      expect(result.lastConversationDate).toBe("2026-09-19");
    });

    it("同じJSTの日のうち（日付が変わる直前） → conversationDaysは変わらない", () => {
      // 2026-09-18T14:59:00Z は JST で 2026-09-18 23:59（まだ同じ日）
      const now = new Date("2026-09-18T14:59:00.000Z");
      const before = record({ conversationDays: 5, lastConversationDate: "2026-09-18" });

      const { record: result } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.conversationDays).toBe(5);
      expect(result.lastConversationDate).toBe("2026-09-18");
    });
  });

  describe("上がる条件の境界", () => {
    it("履歴・関係値ともにちょうど条件を満たす → 上がる", () => {
      const now = new Date("2026-09-19T00:00:00.000Z"); // JST 09:00、新しい日
      const before = record({
        stageKey: "first",
        highestStageKey: "first",
        conversationDays: 2, // 今回の発言で3になり、境界の3を満たす
        conversationCount: 4, // 今回の発言で5になり、境界の5を満たす
        lastConversationDate: "2026-09-17",
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception({ familiarity: 45 }), // ちょうど境界
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.stageKey).toBe("acquainted");
      expect(result.highestStageKey).toBe("acquainted");
      expect(milestones).toEqual([
        { kind: "promoted", fromStageKey: "first", toStageKey: "acquainted", at: now.toISOString() },
      ]);
    });

    it("履歴が1足りない（conversationCountが4のまま） → 上がらない", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");
      const before = record({
        stageKey: "first",
        highestStageKey: "first",
        conversationDays: 3,
        conversationCount: 3, // 今回の発言で4になり、5に1足りない
        lastConversationDate: "2026-09-19", // 今日すでに発言済みなのでconversationDaysは増えない
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception({ familiarity: 45 }),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.stageKey).toBe("first");
      expect(milestones).toEqual([]);
    });

    it("履歴の条件は満たすが関係値の条件だけ満たさない → 上がらない", () => {
      const now = new Date("2026-09-19T00:00:00.000Z");
      const before = record({
        stageKey: "first",
        highestStageKey: "first",
        conversationDays: 3,
        conversationCount: 10,
        lastConversationDate: "2026-09-19",
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception({ familiarity: 44 }), // 45に1足りない
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(result.stageKey).toBe("first");
      expect(milestones).toEqual([]);
    });
  });

  it("1回で1段階だけ上がる（複数段階先の条件も満たしていても1段階のみ）", () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    const before = record({
      stageKey: "first",
      highestStageKey: "first",
      conversationDays: 100,
      conversationCount: 500,
      lastConversationDate: "2026-09-01",
    });

    const { record: result } = advanceRelationship({
      record: before,
      stages: STAGES,
      perception: perception({ familiarity: 100, trust: 100, affection: 100 }),
      now,
      timeZone: TZ,
      isPlayerMessage: true,
    });

    expect(result.stageKey).toBe("acquainted");
  });

  it("最後の段階（special）より上がらない", () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    const before = record({
      stageKey: "special",
      highestStageKey: "special",
      conversationDays: 1000,
      conversationCount: 5000,
      lastConversationDate: "2026-09-01",
    });

    const { record: result, milestones } = advanceRelationship({
      record: before,
      stages: STAGES,
      perception: perception({ familiarity: 100, trust: 100, affection: 100 }),
      now,
      timeZone: TZ,
      isPlayerMessage: true,
    });

    expect(result.stageKey).toBe("special");
    expect(milestones).toEqual([]);
  });

  describe("下がる判定", () => {
    it("60日ちょうど経過 → 1段階下がる", () => {
      const lastConversationAt = "2026-07-21T00:00:00.000Z";
      const now = new Date(new Date(lastConversationAt).getTime() + DEMOTE_AFTER_DAYS * MS_PER_DAY);
      const before = record({
        stageKey: "close",
        highestStageKey: "close",
        lastConversationAt,
        lastDemotedAt: null,
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(result.stageKey).toBe("acquainted");
      expect(result.highestStageKey).toBe("close"); // highestは変えない
      expect(result.recoveryRemaining).toBe(RECOVERY_MESSAGES);
      expect(result.lastDemotedAt).toBe(now.toISOString());
      expect(milestones).toEqual([
        { kind: "demoted", fromStageKey: "close", toStageKey: "acquainted", at: now.toISOString() },
      ]);
    });

    it("59日台（60日未満） → 下がらない", () => {
      const lastConversationAt = "2026-07-21T00:00:00.000Z";
      const now = new Date(
        new Date(lastConversationAt).getTime() + DEMOTE_AFTER_DAYS * MS_PER_DAY - 60 * 1000
      );
      const before = record({ stageKey: "close", highestStageKey: "close", lastConversationAt });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(result.stageKey).toBe("close");
      expect(result.recoveryRemaining).toBe(0);
      expect(milestones).toEqual([]);
    });

    it("先頭の段階（first）では下がらない", () => {
      const lastConversationAt = "2026-01-01T00:00:00.000Z"; // 十分に古い
      const now = new Date("2026-09-19T00:00:00.000Z");
      // 上がる判定に紛れ込まないよう、履歴は次の段階の条件を満たさない値にしておく
      const before = record({
        stageKey: "first",
        highestStageKey: "first",
        lastConversationAt,
        conversationDays: 0,
        conversationCount: 0,
        lastConversationDate: null,
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(result.stageKey).toBe("first");
      expect(result.recoveryRemaining).toBe(0);
      expect(result.lastDemotedAt).toBeNull();
      expect(milestones).toEqual([]);
    });

    it("同じ不在で2回下がらない（発言なしの呼び出しを2回）", () => {
      const lastConversationAt = "2026-01-01T00:00:00.000Z";
      const now1 = new Date("2026-09-19T00:00:00.000Z");
      const before = record({ stageKey: "close", highestStageKey: "close", lastConversationAt });

      const { record: afterFirst, milestones: firstMilestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception(),
        now: now1,
        timeZone: TZ,
        isPlayerMessage: false,
      });
      expect(afterFirst.stageKey).toBe("acquainted");
      expect(firstMilestones).toHaveLength(1);

      const now2 = new Date(now1.getTime() + 10 * MS_PER_DAY); // さらに時間が経っても、まだ発言していない
      const { record: afterSecond, milestones: secondMilestones } = advanceRelationship({
        record: afterFirst,
        stages: STAGES,
        perception: perception(),
        now: now2,
        timeZone: TZ,
        isPlayerMessage: false,
      });

      expect(afterSecond.stageKey).toBe("acquainted"); // さらに下がらない
      expect(afterSecond.lastDemotedAt).toBe(afterFirst.lastDemotedAt); // 更新されない
      expect(secondMilestones).toEqual([]);
    });
  });

  describe("戻る判定", () => {
    function demotedRecord(overrides: Partial<RelationshipRecord> = {}): RelationshipRecord {
      return record({
        stageKey: "acquainted",
        highestStageKey: "close",
        recoveryRemaining: RECOVERY_MESSAGES,
        lastDemotedAt: "2026-09-01T00:00:00.000Z",
        lastConversationAt: "2026-09-01T00:00:00.000Z",
        lastConversationDate: "2026-09-01",
        conversationDays: 3, // acquainted の条件はすでに満たしている（戻り先はcloseなので上がる判定の対象外）
        conversationCount: 5,
        ...overrides,
      });
    }

    it("下がったあと4回の発言では、まだ戻らない", () => {
      let current = demotedRecord();
      let now = new Date("2026-09-02T00:00:00.000Z");

      for (let i = 0; i < 4; i++) {
        const { record: result, milestones } = advanceRelationship({
          record: current,
          stages: STAGES,
          perception: perception(),
          now,
          timeZone: TZ,
          isPlayerMessage: true,
        });
        expect(result.stageKey).toBe("acquainted");
        expect(milestones.filter((m) => m.kind === "recovered")).toEqual([]);
        current = result;
        now = new Date(now.getTime() + MS_PER_DAY);
      }

      expect(current.recoveryRemaining).toBe(1);
    });

    it("下がったあと5回の発言で、下がる前の段階（highestStageKey）に戻る", () => {
      let current = demotedRecord();
      let now = new Date("2026-09-02T00:00:00.000Z");
      let lastMilestones: ReturnType<typeof advanceRelationship>["milestones"] = [];

      for (let i = 0; i < 5; i++) {
        const { record: result, milestones } = advanceRelationship({
          record: current,
          stages: STAGES,
          perception: perception(),
          now,
          timeZone: TZ,
          isPlayerMessage: true,
        });
        current = result;
        lastMilestones = milestones;
        now = new Date(now.getTime() + MS_PER_DAY);
      }

      expect(current.stageKey).toBe("close");
      expect(current.recoveryRemaining).toBe(0);
      expect(lastMilestones).toEqual([
        { kind: "recovered", fromStageKey: "acquainted", toStageKey: "close", at: expect.any(String) },
      ]);
    });

    it("下がっている間は、条件を満たしていても上がる判定をしない", () => {
      const now = new Date("2026-09-02T00:00:00.000Z");
      const before = demotedRecord({
        conversationDays: 100,
        conversationCount: 500,
      });

      const { record: result, milestones } = advanceRelationship({
        record: before,
        stages: STAGES,
        perception: perception({ familiarity: 100, trust: 100, affection: 100 }),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      // recoveryRemainingはまだ0にならない（5→4）ので、上がる判定は行われない
      expect(result.recoveryRemaining).toBe(RECOVERY_MESSAGES - 1);
      expect(result.stageKey).toBe("acquainted");
      expect(milestones.some((m) => m.kind === "promoted")).toBe(false);
    });

    it("戻ったあと、次の呼び出しでは上がる判定が行われる", () => {
      let current = demotedRecord({ conversationDays: 100, conversationCount: 500 });
      let now = new Date("2026-09-02T00:00:00.000Z");

      for (let i = 0; i < 5; i++) {
        const { record: result } = advanceRelationship({
          record: current,
          stages: STAGES,
          perception: perception({ familiarity: 100, trust: 100, affection: 100 }),
          now,
          timeZone: TZ,
          isPlayerMessage: true,
        });
        current = result;
        now = new Date(now.getTime() + MS_PER_DAY);
      }
      expect(current.stageKey).toBe("close"); // 戻り切った直後

      const { record: after, milestones } = advanceRelationship({
        record: current,
        stages: STAGES,
        perception: perception({ familiarity: 100, trust: 100, affection: 100 }),
        now,
        timeZone: TZ,
        isPlayerMessage: true,
      });

      expect(after.stageKey).toBe("special"); // closeの次の段階に上がれる
      expect(milestones).toEqual([
        { kind: "promoted", fromStageKey: "close", toStageKey: "special", at: now.toISOString() },
      ]);
    });
  });

  it("未知のstageKey（contentの差し替え等） → 先頭の段階として扱われる", () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    const before = record({
      stageKey: "no-longer-exists",
      highestStageKey: "no-longer-exists",
      lastConversationAt: "2026-01-01T00:00:00.000Z", // 十分古い。下がる判定でも先頭扱いなら下がらない
      conversationDays: 2,
      conversationCount: 4,
      lastConversationDate: "2026-09-17",
    });

    const { record: result, milestones } = advanceRelationship({
      record: before,
      stages: STAGES,
      perception: perception({ familiarity: 45 }),
      now,
      timeZone: TZ,
      isPlayerMessage: true,
    });

    // 先頭（first）扱いなので下がらず、first→acquainted への昇格条件を見る
    expect(milestones.some((m) => m.kind === "demoted")).toBe(false);
    expect(result.stageKey).toBe("acquainted");
  });

  it("入力のrecordを書き換えない", () => {
    const before = record({ stageKey: "first", highestStageKey: "first", conversationDays: 2, conversationCount: 4 });
    const snapshot = { ...before };
    const now = new Date("2026-09-19T00:00:00.000Z");

    advanceRelationship({
      record: before,
      stages: STAGES,
      perception: perception({ familiarity: 45 }),
      now,
      timeZone: TZ,
      isPlayerMessage: true,
    });

    expect(before).toEqual(snapshot);
  });

  it("節目の内容（kind/fromStageKey/toStageKey/at）が正しい", () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    const before = record({
      stageKey: "first",
      highestStageKey: "first",
      conversationDays: 2,
      conversationCount: 4,
      lastConversationDate: "2026-09-17",
    });

    const { milestones } = advanceRelationship({
      record: before,
      stages: STAGES,
      perception: perception({ familiarity: 45 }),
      now,
      timeZone: TZ,
      isPlayerMessage: true,
    });

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toEqual({
      kind: "promoted",
      fromStageKey: "first",
      toStageKey: "acquainted",
      at: now.toISOString(),
    });
  });
});
