import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getRelevantMemories: vi.fn(),
  saveEvent: vi.fn(),
}));

import { runEventResolver } from "../../../src/eventResolver/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import { getRelevantMemories, saveEvent } from "../../../src/lib/dynamo.js";
import type {
  CharacterDefinition,
  CharacterMemoryItem,
  EventResolverRequest,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);
const mockedSaveEvent = vi.mocked(saveEvent);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "eventResolverテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: "Asia/Tokyo",
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "eventResolverテスト用の性格マーカー",
  speechStyle: "",
  relationship: "",
  background: "eventResolverテスト用の背景マーカー",
  speechExamples: [],
};

function baseReq(overrides: Partial<EventResolverRequest> = {}): EventResolverRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lastLoginAt: "2026-08-10T10:00:00.000Z",
    now: "2026-08-11T14:30:00.000Z",
    ...overrides,
  };
}

function memory(overrides: Partial<CharacterMemoryItem>): CharacterMemoryItem {
  return {
    memory_id: "char-1",
    index: "mem-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedSaveEvent.mockResolvedValue(undefined);
  // 既定では fallback（第3引数）をそのまま返す = 実際の invokeModelJson がフォールバックした場合と同じ挙動
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("経過時間(elapsed)の文字列", () => {
  it("時間と分の両方が発生 → 「N時間M分」", async () => {
    const result = await runEventResolver(
      baseReq({ lastLoginAt: "2026-08-10T10:00:00.000Z", now: "2026-08-11T14:30:00.000Z" })
    );

    expect(result.elapsed).toBe("28時間30分");
  });

  it("分がちょうど0 → 「N時間」のみ（0分は付かない）", async () => {
    const result = await runEventResolver(
      baseReq({ lastLoginAt: "2026-08-10T10:00:00.000Z", now: "2026-08-11T14:00:00.000Z" })
    );

    expect(result.elapsed).toBe("28時間");
  });
});

describe("startDatetime / endDatetime", () => {
  it("ISO8601に正規化されて返る", async () => {
    const result = await runEventResolver(
      baseReq({ lastLoginAt: "2026-08-10T10:00:00", now: "2026-08-11T14:30:00" })
    );

    expect(result.startDatetime).toBe(new Date("2026-08-10T10:00:00").toISOString());
    expect(result.endDatetime).toBe(new Date("2026-08-11T14:30:00").toISOString());
  });
});

describe("重要記憶の取得", () => {
  it("getRelevantMemoriesはクエリ指定なしで呼ばれる（characterIdのみ）", async () => {
    await runEventResolver(baseReq());

    expect(mockedGetRelevantMemories).toHaveBeenCalledTimes(1);
    expect(mockedGetRelevantMemories.mock.calls[0]).toEqual(["char-1"]);
  });

  it("記憶がある → プロンプトに記憶の内容が入る", async () => {
    mockedGetRelevantMemories.mockResolvedValue([
      memory({ eventSummary: "文化祭の準備を手伝った", characterInterpretation: "楽しかった" }),
    ]);

    await runEventResolver(baseReq());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("文化祭の準備を手伝った");
    expect(systemPrompt).toContain("楽しかった");
  });

  it("記憶がない → プロンプトに「（なし）」が入る", async () => {
    mockedGetRelevantMemories.mockResolvedValue([]);

    await runEventResolver(baseReq());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("【既存の重要記憶】\n（なし）");
  });
});

describe("モデル応答の解釈", () => {
  it("モデルがeventsを返す → そのままeventsになる", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ events: ["朝から雨が降っていた", "友達と話した"] });

    const result = await runEventResolver(baseReq());

    expect(result.events).toEqual(["朝から雨が降っていた", "友達と話した"]);
  });

  it("fallback（invokeModelJsonが第3引数をそのまま返す） → events: []", async () => {
    // beforeEachの既定実装がfallbackをそのまま返すため、追加の設定なしでfallback相当になる
    const result = await runEventResolver(baseReq());

    expect(result.events).toEqual([]);
  });

  it("モデル応答にeventsが無い → events: []", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({} as never);

    const result = await runEventResolver(baseReq());

    expect(result.events).toEqual([]);
  });
});

describe("UUID", () => {
  it("UUID形式のUUIDを返す", async () => {
    const result = await runEventResolver(baseReq());

    expect(result.UUID).toMatch(UUID_PATTERN);
  });
});

describe("saveEventへの保存", () => {
  it("event_id・characterId・期間・eventsが渡る", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ events: ["出来事A"] });

    const result = await runEventResolver(baseReq({ characterId: "char-xyz" }));

    expect(mockedSaveEvent).toHaveBeenCalledTimes(1);
    const item = mockedSaveEvent.mock.calls[0][0];
    expect(item.event_id).toBe(result.UUID);
    expect(item.characterId).toBe("char-xyz");
    expect(item.startDatetime).toBe(result.startDatetime);
    expect(item.endDatetime).toBe(result.endDatetime);
    expect(item.elapsed).toBe(result.elapsed);
    expect(item.events).toEqual(["出来事A"]);
  });
});

describe("現状の挙動の確認（now が lastLoginAt より前）", () => {
  // 入力チェックが無いため now < lastLoginAt でも例外にはならないが、
  // elapsed が負の値になり「-2時間」のような不自然な文字列になる。
  it("nowがlastLoginAtの90分前 → elapsedが「-2時間」になる（Math.floorの向きにより-1.5時間が-2時間に丸まる）", async () => {
    const result = await runEventResolver(
      baseReq({ lastLoginAt: "2026-09-17T10:00:00.000Z", now: "2026-09-17T08:30:00.000Z" })
    );

    expect(result.elapsed).toBe("-2時間");
  });
});
