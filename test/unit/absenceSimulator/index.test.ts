import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getLatestAbsenceRecord: vi.fn(),
  getRecentAbsenceRecords: vi.fn(),
  getRelevantMemories: vi.fn(),
  saveAbsenceRecord: vi.fn(),
}));

import {
  runAbsenceSimulator,
  RECENT_ABSENCE_RECORD_COUNT,
  MAX_OUTPUT_TOKENS,
} from "../../../src/absenceSimulator/index.js";
import { EMPTY_MODEL_OUTPUT } from "../../../src/absenceSimulator/modelOutput.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import {
  getLatestAbsenceRecord,
  getRecentAbsenceRecords,
  getRelevantMemories,
  saveAbsenceRecord,
} from "../../../src/lib/dynamo.js";
import type {
  AbsenceRecord,
  AbsenceSimulatorRequest,
  CharacterDefinition,
  Lifestyle,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);
const mockedGetRecentAbsenceRecords = vi.mocked(getRecentAbsenceRecords);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedSaveAbsenceRecord = vi.mocked(saveAbsenceRecord);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIME_ZONE = "Asia/Tokyo";

// システムの現在時刻（createdAt になる値）を固定する。2026-09-22T01:00:00.000Z = 火曜10:00 JST。
const SYSTEM_NOW = "2026-09-22T01:00:00.000Z";
// SYSTEM_NOW の3時間前（火曜07:00 JST）。skeleton.test.ts と同じ組み合わせを使い、
// buildActionSlots の結果を流用できるようにする。
const LAST_LOGIN_AT = "2026-09-21T22:00:00.000Z";

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "absenceSimulatorテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: TIME_ZONE,
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "absenceSimulatorテスト用の性格マーカー",
  speechStyle: "",
  relationship: "",
  background: "absenceSimulatorテスト用の背景マーカー",
  speechExamples: [],
};

// 就寝(23:00〜07:00)を含む、日をまたぐ枠を持つ生活様式（skeleton.test.ts と同じもの）。
const lifestyle: Lifestyle = {
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

// LAST_LOGIN_AT 〜 SYSTEM_NOW（3時間）で buildActionSlots が返す、期待される行動の枠の時刻。
const EXPECTED_ACTION_SLOT_TIMES = [
  { startDatetime: "2026-09-21T22:00:00.000Z", endDatetime: "2026-09-21T23:00:00.000Z" },
  { startDatetime: "2026-09-21T23:00:00.000Z", endDatetime: "2026-09-22T01:00:00.000Z" },
];

function baseReq(overrides: Partial<AbsenceSimulatorRequest> = {}): AbsenceSimulatorRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lifestyle,
    lastLoginAt: LAST_LOGIN_AT,
    now: SYSTEM_NOW,
    ...overrides,
  };
}

function record(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "prev-event",
    characterId: "char-1",
    createdAt: "2026-09-18T01:00:00.000Z",
    startDatetime: "2026-09-17T22:00:00.000Z",
    endDatetime: "2026-09-18T01:00:00.000Z",
    events: [],
    actions: [],
    threads: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  vi.useFakeTimers();
  vi.setSystemTime(new Date(SYSTEM_NOW));

  // eventKinds の抽選を常に先頭（daily）に固定する。
  vi.spyOn(Math, "random").mockReturnValue(0);

  mockedGetLatestAbsenceRecord.mockResolvedValue(null);
  mockedGetRecentAbsenceRecords.mockResolvedValue([]);
  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedSaveAbsenceRecord.mockResolvedValue(undefined);
  // 既定では fallback（第3引数）をそのまま返す = invokeModelJson がフォールバックした場合と同じ挙動
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("正常なLLM出力", () => {
  it("レスポンスのeventsはkind/summary/detailだけを持ち、actionsの時刻は骨格の枠と一致する", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({
      events: [{ summary: "文化祭の準備をした", detail: "友達と一緒に飾り付けをした" }],
      actions: [
        { index: 1, action: "早起きして体操した", memo: "気持ちよかった" },
        { index: 2, action: "友達と喋りながら過ごした", memo: "" },
      ],
      threadUpdates: [],
      newThreads: [],
    });

    const result = await runAbsenceSimulator(baseReq());

    expect(result.events).toEqual([
      { kind: "daily", summary: "文化祭の準備をした", detail: "友達と一緒に飾り付けをした" },
    ]);
    expect(Object.keys(result.events[0]).sort()).toEqual(["detail", "kind", "summary"]);

    expect(result.actions).toEqual([
      { ...EXPECTED_ACTION_SLOT_TIMES[0], action: "早起きして体操した", memo: "気持ちよかった" },
      { ...EXPECTED_ACTION_SLOT_TIMES[1], action: "友達と喋りながら過ごした", memo: "" },
    ]);
  });
});

describe("saveAbsenceRecordへの保存", () => {
  it("event_idはUUID、characterId・createdAtはシステム時刻、events/actionsはレスポンスと整合する", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({
      events: [{ summary: "出来事A", detail: "詳細A" }],
      actions: [{ index: 1, action: "行動A", memo: "メモA" }],
      threadUpdates: [],
      newThreads: [],
    });

    const result = await runAbsenceSimulator(baseReq({ characterId: "char-abc" }));

    expect(mockedSaveAbsenceRecord).toHaveBeenCalledTimes(1);
    const saved = mockedSaveAbsenceRecord.mock.calls[0][0];

    expect(saved.event_id).toMatch(UUID_PATTERN);
    expect(saved.characterId).toBe("char-abc");
    expect(saved.createdAt).toBe(SYSTEM_NOW);
    expect(saved.startDatetime).toBe(result.startDatetime);
    expect(saved.endDatetime).toBe(result.endDatetime);
    expect(saved.events.map(({ kind, summary, detail }) => ({ kind, summary, detail }))).toEqual(
      result.events
    );
    expect(saved.actions).toEqual(result.actions);
  });
});

describe("invokeModelJsonの呼び出し", () => {
  it("システムプロンプトが2要素の配列(層)で渡り、fallbackがEMPTY_MODEL_OUTPUT、maxTokensがMAX_OUTPUT_TOKENS", async () => {
    await runAbsenceSimulator(baseReq());

    expect(mockedInvokeModelJson).toHaveBeenCalledTimes(1);
    const [systemPrompt, userMessage, fallback, maxTokens] = mockedInvokeModelJson.mock.calls[0];

    expect(Array.isArray(systemPrompt)).toBe(true);
    expect(systemPrompt).toHaveLength(2);
    expect(typeof userMessage).toBe("string");
    expect((userMessage as string).length).toBeGreaterThan(0);
    expect(fallback).toBe(EMPTY_MODEL_OUTPUT);
    expect(maxTokens).toBe(MAX_OUTPUT_TOKENS);
  });
});

describe("直近の記録", () => {
  it("getRecentAbsenceRecordsが(characterId, 3)で呼ばれ、その出来事のsummaryがプロンプトの可変部(layers[1])に入る", async () => {
    mockedGetRecentAbsenceRecords.mockResolvedValueOnce([
      record({
        event_id: "recent-1",
        events: [{ kind: "daily", summary: "公園で猫を見た", detail: "しばらく眺めていた" }],
      }),
    ]);

    await runAbsenceSimulator(baseReq());

    expect(mockedGetRecentAbsenceRecords).toHaveBeenCalledWith("char-1", RECENT_ABSENCE_RECORD_COUNT);

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0] as string[];
    expect(systemPrompt[1]).toContain("公園で猫を見た");
  });
});

describe("続いている話題", () => {
  it("最新の記録の開いている話題が可変部に入り、LLMが閉じた話題はclosed、新しい話題はopenで追加される", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValueOnce(
      record({
        threads: [
          // 5日前に開始 → 続いている話題としてプロンプトに入る
          { id: "thread-recent", topic: "recent topic", status: "open", openedAt: "2026-09-17T01:00:00.000Z" },
          // 15日前に開始 → 14日を超えているため自動でclosedになる
          { id: "thread-old", topic: "old topic", status: "open", openedAt: "2026-09-07T01:00:00.000Z" },
          // 前回すでに閉じている話題 → 今回の記録に引き継がれない
          {
            id: "thread-closed-before",
            topic: "already closed topic",
            status: "closed",
            openedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      })
    );
    mockedInvokeModelJson.mockResolvedValueOnce({
      events: [],
      actions: [],
      threadUpdates: [{ id: "thread-recent", status: "closed" }],
      newThreads: [{ topic: "new topic" }],
    });

    await runAbsenceSimulator(baseReq());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0] as string[];
    expect(systemPrompt[1]).toContain("recent topic");
    expect(systemPrompt[1]).not.toContain("old topic");

    const saved = mockedSaveAbsenceRecord.mock.calls[0][0];
    const byId = new Map(saved.threads.map((t) => [t.id, t]));

    expect(byId.get("thread-recent")?.status).toBe("closed");
    expect(byId.get("thread-old")?.status).toBe("closed");
    expect(saved.threads.some((t) => t.topic === "already closed topic")).toBe(false);
    const newThread = saved.threads.find((t) => t.topic === "new topic");
    expect(newThread?.status).toBe("open");
  });
});

describe("最新の記録が無い場合", () => {
  it("getLatestAbsenceRecordがnull → 話題なしで動く", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValueOnce(null);

    const result = await runAbsenceSimulator(baseReq());

    expect(result).toBeDefined();
    expect(mockedSaveAbsenceRecord).toHaveBeenCalledTimes(1);
    expect(mockedSaveAbsenceRecord.mock.calls[0][0].threads).toEqual([]);
  });
});

describe("LLM呼び出しの失敗", () => {
  it("invokeModelJsonがreject → 例外を投げず、出来事は空、行動は生活リズムのactivity・memo空、記録は保存され、前回の話題は引き継がれる", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValueOnce(
      record({
        threads: [
          { id: "thread-x", topic: "続いている話題", status: "open", openedAt: "2026-09-20T01:00:00.000Z" },
        ],
      })
    );
    mockedInvokeModelJson.mockRejectedValueOnce(new Error("throttled"));

    const result = await runAbsenceSimulator(baseReq());

    expect(result.events).toEqual([]);
    expect(result.actions).toEqual([
      { ...EXPECTED_ACTION_SLOT_TIMES[0], action: "起床", memo: "" },
      { ...EXPECTED_ACTION_SLOT_TIMES[1], action: "学校", memo: "" },
    ]);

    expect(mockedSaveAbsenceRecord).toHaveBeenCalledTimes(1);
    const saved = mockedSaveAbsenceRecord.mock.calls[0][0];
    const carried = saved.threads.find((t) => t.id === "thread-x");
    expect(carried?.status).toBe("open");
  });

  it("invokeModelJsonがfallback相当の出力を返す(パース失敗相当) → 同じくフォールバックの記録になる", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ events: [], actions: [], threadUpdates: [], newThreads: [] });

    const result = await runAbsenceSimulator(baseReq());

    expect(result.events).toEqual([]);
    expect(result.actions.every((a) => a.memo === "")).toBe(true);
    expect(result.actions.map((a) => a.action)).toEqual(["起床", "学校"]);
  });
});

describe("DynamoDBの保存失敗", () => {
  it("saveAbsenceRecordがreject → runAbsenceSimulatorもrejectする", async () => {
    mockedSaveAbsenceRecord.mockRejectedValueOnce(new Error("ddb down"));

    await expect(runAbsenceSimulator(baseReq())).rejects.toThrow("ddb down");
  });
});

describe("プロンプトの固定部", () => {
  it("異なる不在期間・異なる話題で呼んでも同じ文字列になる（キャッシュの前提）", async () => {
    await runAbsenceSimulator(baseReq({ lastLoginAt: LAST_LOGIN_AT, now: SYSTEM_NOW }));
    const firstFixed = (mockedInvokeModelJson.mock.calls[0][0] as string[])[0];

    mockedGetLatestAbsenceRecord.mockResolvedValueOnce(
      record({
        threads: [{ id: "thread-y", topic: "別の話題", status: "open", openedAt: "2026-09-21T00:00:00.000Z" }],
      })
    );
    // 27時間前（異なる不在期間 → 骨格・出来事件数が変わる）
    await runAbsenceSimulator(baseReq({ lastLoginAt: "2026-09-20T22:00:00.000Z", now: SYSTEM_NOW }));
    const secondFixed = (mockedInvokeModelJson.mock.calls[1][0] as string[])[0];

    expect(firstFixed).toBe(secondFixed);
  });
});
