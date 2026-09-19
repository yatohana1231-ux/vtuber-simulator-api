import { describe, it, expect } from "vitest";
import {
  addMessageToSession,
  isSessionEnded,
  settleSession,
} from "../../../../src/lib/affect/sessionAccumulator.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import type { AffectConfig } from "../../../../src/lib/affect/affectConfig.js";
import type { PendingSession, PerceptionContribution } from "../../../../src/types.js";

const ZERO_CONTRIBUTION: Required<PerceptionContribution> = {
  trust: 0,
  affection: 0,
  respect: 0,
  fear: 0,
  dependence: 0,
  familiarity: 0,
};

function pendingSession(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    startedAt: "2026-09-19T10:00:00.000Z",
    lastMessageAt: "2026-09-19T10:00:00.000Z",
    messageCount: 1,
    peak: { ...ZERO_CONTRIBUTION },
    last: { ...ZERO_CONTRIBUTION },
    ...overrides,
  };
}

describe("addMessageToSession", () => {
  it("pending が null → 新しいセッションが作られる（startedAt・lastMessageAt・messageCount 1）", () => {
    const now = new Date("2026-09-19T10:00:00.000Z");

    const result = addMessageToSession(null, { trust: 2 }, now);

    expect(result.startedAt).toBe(now.toISOString());
    expect(result.lastMessageAt).toBe(now.toISOString());
    expect(result.messageCount).toBe(1);
  });

  it("2回目以降 → messageCount が進み lastMessageAt が更新され、startedAt は変わらない", () => {
    const before = pendingSession({
      startedAt: "2026-09-19T10:00:00.000Z",
      lastMessageAt: "2026-09-19T10:00:00.000Z",
      messageCount: 1,
    });
    const now = new Date("2026-09-19T10:05:00.000Z");

    const result = addMessageToSession(before, { trust: 1 }, now);

    expect(result.messageCount).toBe(2);
    expect(result.lastMessageAt).toBe(now.toISOString());
    expect(result.startedAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("peak → 今回の絶対値のほうが大きい正の値なら、今回の値に更新される", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: 2 } });

    const result = addMessageToSession(before, { trust: 5 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.peak.trust).toBe(5);
  });

  it("peak → 負の大きい値が正の小さい値に勝つ（絶対値で比較する）", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: 2 } });

    const result = addMessageToSession(before, { trust: -5 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.peak.trust).toBe(-5);
  });

  it("peak → 絶対値が今回より前のほうが大きいときは、前の値のまま", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: -5 } });

    const result = addMessageToSession(before, { trust: 2 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.peak.trust).toBe(-5);
  });

  it("peak → 絶対値が同じなら前の値のまま", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: -5 } });

    const result = addMessageToSession(before, { trust: 5 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.peak.trust).toBe(-5);
  });

  it("peak → 軸ごとに独立して判定される", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: 5, affection: -3 } });

    const result = addMessageToSession(before, { trust: 1, affection: -10 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.peak.trust).toBe(5); // 前のほうが大きいので変わらない
    expect(result.peak.affection).toBe(-10); // 今回のほうが大きいので更新される
  });

  it("last → 今回の寄与で上書きされる", () => {
    const before = pendingSession({ last: { ...ZERO_CONTRIBUTION, trust: 5 } });

    const result = addMessageToSession(before, { trust: -2 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.last.trust).toBe(-2);
  });

  it("last → 今回書いていない軸は0になる", () => {
    const before = pendingSession({ last: { ...ZERO_CONTRIBUTION, familiarity: 3 } });

    const result = addMessageToSession(before, { trust: 2 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(result.last.familiarity).toBe(0);
    expect(result.last.trust).toBe(2);
  });

  it("引数の pending を書き換えない", () => {
    const before = pendingSession({ peak: { ...ZERO_CONTRIBUTION, trust: 2 }, last: { ...ZERO_CONTRIBUTION, trust: 2 } });
    const snapshot = JSON.parse(JSON.stringify(before));

    addMessageToSession(before, { trust: 5 }, new Date("2026-09-19T10:05:00.000Z"));

    expect(before).toEqual(snapshot);
  });

  it("引数の contribution を書き換えない", () => {
    const contribution: PerceptionContribution = { trust: 5 };
    const snapshot = { ...contribution };

    addMessageToSession(pendingSession(), contribution, new Date("2026-09-19T10:05:00.000Z"));

    expect(contribution).toEqual(snapshot);
  });
});

describe("isSessionEnded", () => {
  it("間隔がちょうど sessionGapMinutes → 終わったとみなす", () => {
    const pending = pendingSession({ lastMessageAt: "2026-09-19T10:00:00.000Z" });
    const now = new Date("2026-09-19T10:30:00.000Z"); // 既定値は30分

    expect(isSessionEnded(pending, now)).toBe(true);
  });

  it("間隔が sessionGapMinutes の1分手前 → まだ終わっていない", () => {
    const pending = pendingSession({ lastMessageAt: "2026-09-19T10:00:00.000Z" });
    const now = new Date("2026-09-19T10:29:00.000Z");

    expect(isSessionEnded(pending, now)).toBe(false);
  });

  it("config を差し替えると、その値で境界が変わる", () => {
    const pending = pendingSession({ lastMessageAt: "2026-09-19T10:00:00.000Z" });
    const now = new Date("2026-09-19T10:10:00.000Z");
    const config: AffectConfig = {
      ...DEFAULT_AFFECT_CONFIG,
      perception: { ...DEFAULT_AFFECT_CONFIG.perception, sessionGapMinutes: 10 },
    };

    expect(isSessionEnded(pending, now, config)).toBe(true);
    expect(isSessionEnded(pending, now)).toBe(false); // 既定値（30分）では終わっていない
  });
});

describe("settleSession", () => {
  it("軸ごとに (peak + last) / 2 を返す", () => {
    const pending = pendingSession({
      peak: { ...ZERO_CONTRIBUTION, trust: 10, affection: -8 },
      last: { ...ZERO_CONTRIBUTION, trust: 4, affection: -2 },
    });

    const result = settleSession(pending);

    expect(result.trust).toBe(7);
    expect(result.affection).toBe(-5);
  });

  it("発言が1回だけ（peak = last）なら、その値になる", () => {
    const pending = pendingSession({
      peak: { ...ZERO_CONTRIBUTION, trust: 3 },
      last: { ...ZERO_CONTRIBUTION, trust: 3 },
    });

    const result = settleSession(pending);

    expect(result.trust).toBe(3);
  });

  it("PERCEPTION_KEYS の全軸を返す", () => {
    const pending = pendingSession();

    const result = settleSession(pending);

    expect(Object.keys(result).sort()).toEqual(
      ["affection", "dependence", "familiarity", "fear", "respect", "trust"].sort()
    );
  });

  it("引数の pending を書き換えない", () => {
    const before = pendingSession({
      peak: { ...ZERO_CONTRIBUTION, trust: 10 },
      last: { ...ZERO_CONTRIBUTION, trust: 4 },
    });
    const snapshot = JSON.parse(JSON.stringify(before));

    settleSession(before);

    expect(before).toEqual(snapshot);
  });
});
