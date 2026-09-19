import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadScenarios, resolveDatetime, resolveScenarioDatetimes } from "./scenarios.js";
import type { Scenario } from "./types.js";

describe("resolveDatetime", () => {
  const BASE = new Date("2026-01-15T00:00:00.000Z");

  it("'now' → baseTime のISO8601", () => {
    expect(resolveDatetime("now", BASE)).toBe("2026-01-15T00:00:00.000Z");
  });

  it("'now-30h' → 30時間前", () => {
    expect(resolveDatetime("now-30h", BASE)).toBe("2026-01-13T18:00:00.000Z");
  });

  it("'now-2d' → 2日前", () => {
    expect(resolveDatetime("now-2d", BASE)).toBe("2026-01-13T00:00:00.000Z");
  });

  it("'now+15m' → 15分後", () => {
    expect(resolveDatetime("now+15m", BASE)).toBe("2026-01-15T00:15:00.000Z");
  });

  it("すでに絶対時刻（ISO8601） → そのまま", () => {
    expect(resolveDatetime("2025-12-25T09:00:00.000Z", BASE)).toBe("2025-12-25T09:00:00.000Z");
  });
});

describe("resolveScenarioDatetimes", () => {
  const BASE = new Date("2026-01-15T00:00:00.000Z");

  it("state・request の日時をすべて解決する（元の scenario は変更しない）", () => {
    const scenario: Scenario = {
      id: "s1",
      function: "absenceSimulator",
      description: "test",
      state: {
        memories: [{ index: "m1", updatedAt: "now-2d" }],
        conversationLogs: [{ index: "now-30h", role: "user", content: "hi" }],
        absenceRecords: [
          {
            createdAt: "now-1h",
            startDatetime: "now-2h",
            endDatetime: "now-1h",
            events: [],
            actions: [{ startDatetime: "now-2h", endDatetime: "now-1h", action: "school", memo: "" }],
            threads: [{ id: "t1", topic: "topic", status: "open", openedAt: "now-2h" }],
          },
        ],
      },
      request: { lastLoginAt: "now-30h", now: "now" },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);

    expect(resolved.state?.memories?.[0].updatedAt).toBe("2026-01-13T00:00:00.000Z");
    expect(resolved.state?.conversationLogs?.[0].index).toBe("2026-01-13T18:00:00.000Z");
    const record = resolved.state?.absenceRecords?.[0];
    expect(record?.createdAt).toBe("2026-01-14T23:00:00.000Z");
    expect(record?.startDatetime).toBe("2026-01-14T22:00:00.000Z");
    expect(record?.endDatetime).toBe("2026-01-14T23:00:00.000Z");
    expect(record?.actions[0].startDatetime).toBe("2026-01-14T22:00:00.000Z");
    expect(record?.threads[0].openedAt).toBe("2026-01-14T22:00:00.000Z");
    expect((resolved.request as { lastLoginAt: string }).lastLoginAt).toBe("2026-01-13T18:00:00.000Z");
    expect((resolved.request as { now: string }).now).toBe("2026-01-15T00:00:00.000Z");

    // 元の scenario は変更されない
    expect(scenario.state?.memories?.[0].updatedAt).toBe("now-2d");
    expect((scenario.request as { now: string }).now).toBe("now");
  });

  it("state.relationship の日時（firstMetAt・lastConversationAt・lastDemotedAt・updatedAt）を解決する。lastConversationDate はそのまま", () => {
    const scenario: Scenario = {
      id: "s3",
      function: "dialogueGenerator",
      description: "test",
      state: {
        relationship: {
          firstMetAt: "now-20d",
          lastConversationAt: "now-3h",
          lastConversationDate: "2026-01-14",
          conversationCount: 10,
          conversationDays: 5,
          stageKey: "close",
          highestStageKey: "close",
          recoveryRemaining: 0,
          lastDemotedAt: "now-30d",
          updatedAt: "now-3h",
        },
      },
      request: { message: "hi" },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);
    const relationship = resolved.state?.relationship;

    expect(relationship?.firstMetAt).toBe("2025-12-26T00:00:00.000Z");
    expect(relationship?.lastConversationAt).toBe("2026-01-14T21:00:00.000Z");
    expect(relationship?.lastDemotedAt).toBe("2025-12-16T00:00:00.000Z");
    expect(relationship?.updatedAt).toBe("2026-01-14T21:00:00.000Z");
    // 暦日（YYYY-MM-DD）は相対指定の対象にしないので、そのまま
    expect(relationship?.lastConversationDate).toBe("2026-01-14");
  });

  it("state.relationship の lastConversationAt/lastDemotedAt が null → 解決せずそのまま null", () => {
    const scenario: Scenario = {
      id: "s4",
      function: "dialogueGenerator",
      description: "test",
      state: {
        relationship: {
          firstMetAt: "now",
          lastConversationAt: null,
          lastConversationDate: null,
          conversationCount: 0,
          conversationDays: 0,
          stageKey: "first",
          highestStageKey: "first",
          recoveryRemaining: 0,
          lastDemotedAt: null,
          updatedAt: "now",
        },
      },
      request: { message: "hi" },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);
    const relationship = resolved.state?.relationship;

    expect(relationship?.lastConversationAt).toBeNull();
    expect(relationship?.lastDemotedAt).toBeNull();
    expect(relationship?.firstMetAt).toBe("2026-01-15T00:00:00.000Z");
  });

  it("state.affect の日時（affectUpdatedAt・pendingSession.startedAt/lastMessageAt）を解決する（D-040）", () => {
    const scenario: Scenario = {
      id: "s5",
      function: "emotionUpdater",
      description: "test",
      state: {
        affect: {
          emotions: { joy: 10 },
          affectUpdatedAt: "now-2d",
          pendingSession: {
            startedAt: "now-40m",
            lastMessageAt: "now-35m",
            messageCount: 2,
            peak: { trust: 3 },
            last: { trust: 1 },
          },
        },
      },
      request: { process: 2, playerMessage: "hi" },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);
    const affect = resolved.state?.affect;

    expect(affect?.affectUpdatedAt).toBe("2026-01-13T00:00:00.000Z");
    expect(affect?.pendingSession?.startedAt).toBe("2026-01-14T23:20:00.000Z");
    expect(affect?.pendingSession?.lastMessageAt).toBe("2026-01-14T23:25:00.000Z");

    // 元の scenario は変更されない
    expect((scenario.state?.affect?.affectUpdatedAt)).toBe("now-2d");
  });

  it("state.affect.affectUpdatedAt を省略 → 未解決のまま undefined（実行開始時刻は execute.ts 側で既定にする）", () => {
    const scenario: Scenario = {
      id: "s6",
      function: "emotionUpdater",
      description: "test",
      state: { affect: { emotions: { joy: 10 } } },
      request: { process: 1 },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);

    expect(resolved.state?.affect?.affectUpdatedAt).toBeUndefined();
  });

  it("dialogueGeneratorのrequest.nowが未指定 → そのままundefined", () => {
    const scenario: Scenario = {
      id: "s2",
      function: "dialogueGenerator",
      description: "test",
      request: { message: "hello" },
    };

    const resolved = resolveScenarioDatetimes(scenario, BASE);

    expect((resolved.request as { now?: string }).now).toBeUndefined();
  });
});

describe("loadScenarios", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai-response-scenarios-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeScenario(fn: string, fileName: string, content: unknown): Promise<void> {
    const folder = path.join(dir, fn);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, fileName), JSON.stringify(content), "utf8");
  }

  it("フォルダごとの *.json を読み込む", async () => {
    await writeScenario("absenceSimulator", "sample-a.json", {
      id: "sample-a",
      function: "absenceSimulator",
      description: "desc",
      request: { lastLoginAt: "now-30h", now: "now" },
    });
    await writeScenario("dialogueGenerator", "sample-b.json", {
      id: "sample-b",
      function: "dialogueGenerator",
      description: "desc",
      request: { message: "hi" },
    });

    const scenarios = await loadScenarios(dir);

    expect(scenarios.map((s) => s.id).sort()).toEqual(["sample-a", "sample-b"]);
  });

  it("存在しないフォルダ（対象の機能のシナリオが無い）はスキップする", async () => {
    await writeScenario("dialogueGenerator", "sample-b.json", {
      id: "sample-b",
      function: "dialogueGenerator",
      description: "desc",
      request: { message: "hi" },
    });

    const scenarios = await loadScenarios(dir);

    expect(scenarios).toHaveLength(1);
  });

  it("idがファイル名と不一致 → 例外", async () => {
    await writeScenario("dialogueGenerator", "sample-b.json", {
      id: "different-id",
      function: "dialogueGenerator",
      description: "desc",
      request: { message: "hi" },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/id.*一致しません/);
  });

  it("functionがフォルダ名と不一致 → 例外", async () => {
    await writeScenario("dialogueGenerator", "sample-b.json", {
      id: "sample-b",
      function: "emotionUpdater",
      description: "desc",
      request: { message: "hi" },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/function.*一致しません/);
  });

  it("descriptionが無い → 例外", async () => {
    await writeScenario("dialogueGenerator", "sample-b.json", {
      id: "sample-b",
      function: "dialogueGenerator",
      request: { message: "hi" },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/description/);
  });

  it("absenceSimulatorでrequest.nowが無い → 例外", async () => {
    await writeScenario("absenceSimulator", "sample-a.json", {
      id: "sample-a",
      function: "absenceSimulator",
      description: "desc",
      request: { lastLoginAt: "now-30h" },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/request\.now/);
  });

  it("emotionUpdaterのprocess=2でplayerMessageが無い → 例外", async () => {
    await writeScenario("emotionUpdater", "sample-e.json", {
      id: "sample-e",
      function: "emotionUpdater",
      description: "desc",
      request: { process: 2 },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/playerMessage/);
  });

  it("emotionUpdaterのrequest.nowが文字列でない → 例外（省略は可）", async () => {
    await writeScenario("emotionUpdater", "sample-e2.json", {
      id: "sample-e2",
      function: "emotionUpdater",
      description: "desc",
      request: { process: 1, now: 12345 },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/request\.now/);
  });

  it("state.affect がオブジェクトでない → 例外", async () => {
    await writeScenario("emotionUpdater", "sample-e3.json", {
      id: "sample-e3",
      function: "emotionUpdater",
      description: "desc",
      state: { affect: "not-an-object" },
      request: { process: 1 },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/state\.affect/);
  });

  it("memoryRetrieverのprocessが不正 → 例外", async () => {
    await writeScenario("memoryRetriever", "sample-m.json", {
      id: "sample-m",
      function: "memoryRetriever",
      description: "desc",
      request: { process: 3 },
    });

    await expect(loadScenarios(dir)).rejects.toThrow(/process/);
  });

  it("壊れたJSON → 例外", async () => {
    const folder = path.join(dir, "dialogueGenerator");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "broken.json"), "{ not json", "utf8");

    await expect(loadScenarios(dir)).rejects.toThrow();
  });
});
