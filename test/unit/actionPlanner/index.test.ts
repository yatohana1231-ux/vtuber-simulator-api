import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", () => ({
  getRelevantMemories: vi.fn(),
}));

import { runActionPlanner } from "../../../src/actionPlanner/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import { getRelevantMemories } from "../../../src/lib/dynamo.js";
import type {
  ActionPlannerRequest,
  CharacterDefinition,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetRelevantMemories = vi.mocked(getRelevantMemories);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "actionPlannerテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "",
  speechStyle: "",
  relationship: "",
  background: "",
  speechExamples: [],
};

function baseReq(overrides: Partial<ActionPlannerRequest> = {}): ActionPlannerRequest {
  return {
    characterId: "char-1",
    world,
    character,
    lastLoginAt: "2026-08-10T10:00:00.000Z",
    now: "2026-08-11T14:30:00.000Z",
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetRelevantMemories.mockResolvedValue([]);
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("不在時間の上限（12時間）", () => {
  it("24時間空いていてもelapsedは12時間になる", async () => {
    await runActionPlanner(
      baseReq({ lastLoginAt: "2026-08-10T10:00:00.000Z", now: "2026-08-11T10:00:00.000Z" })
    );

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("経過時間: 12時間");
  });

  it("プロンプトの開始日時はnowの12時間前になる（24時間空いていてもlastLoginAtの10:00ではない）", async () => {
    const now = "2026-08-11T10:00:00.000Z";
    await runActionPlanner(baseReq({ lastLoginAt: "2026-08-10T10:00:00.000Z", now }));

    const expectedStart = new Date(new Date(now).getTime() - 12 * 60 * 60 * 1000).toISOString();
    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain(expectedStart);
    expect(systemPrompt).not.toContain("2026-08-10T10:00:00.000Z");
  });

  it("不在時間が12時間未満ならそのままの経過時間になる", async () => {
    await runActionPlanner(
      baseReq({ lastLoginAt: "2026-08-11T05:00:00.000Z", now: "2026-08-11T10:00:00.000Z" })
    );

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("経過時間: 5時間");
  });
});

describe("eventsのプロンプトへの反映", () => {
  it("複数件 → 番号付きで入る", async () => {
    await runActionPlanner(baseReq({ events: ["雨が降った", "友達と話した"] }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("1. 雨が降った");
    expect(systemPrompt).toContain("2. 友達と話した");
  });

  it("空配列 → 「（なし）」が入る", async () => {
    await runActionPlanner(baseReq({ events: [] }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("【発生したイベント】\n（なし）");
  });
});

describe("重要記憶の取得", () => {
  it("getRelevantMemoriesはクエリ指定なしで呼ばれる", async () => {
    await runActionPlanner(baseReq());

    expect(mockedGetRelevantMemories.mock.calls[0]).toEqual(["char-1"]);
  });
});

describe("モデル応答の解釈", () => {
  it("actionsが配列 → そのまま返る", async () => {
    const actions = [
      { startDatetime: "2026-08-11T06:00:00.000Z", endDatetime: "2026-08-11T07:00:00.000Z", action: "朝食", memo: "眠そう" },
    ];
    mockedInvokeModelJson.mockResolvedValueOnce({ actions });

    const result = await runActionPlanner(baseReq());

    expect(result.actions).toEqual(actions);
  });

  it("actionsが配列でない → 空配列になる", async () => {
    mockedInvokeModelJson.mockResolvedValueOnce({ actions: "not-an-array" } as never);

    const result = await runActionPlanner(baseReq());

    expect(result.actions).toEqual([]);
  });

  it("fallback（invokeModelJsonが第3引数をそのまま返す） → 空配列になる", async () => {
    const result = await runActionPlanner(baseReq());

    expect(result.actions).toEqual([]);
  });
});

describe("現状の挙動の確認（now が lastLoginAt より前）", () => {
  // 入力チェックが無いため now < lastLoginAt でも例外にはならないが、
  // elapsedMs が負のまま Math.min の対象になるため12時間には切り上がらず、
  // actionStart（now - elapsedMs = now + |elapsedMs|）が actionEnd（now）より後の日時になる
  // （行動期間の開始が終了より後という逆転した範囲がプロンプトに入る）。
  it("nowがlastLoginAtの90分前 → actionStartがactionEndより後になる", async () => {
    const now = "2026-09-17T08:30:00.000Z";
    await runActionPlanner(baseReq({ lastLoginAt: "2026-09-17T10:00:00.000Z", now }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("開始: 2026-09-17T10:00:00.000Z");
    expect(systemPrompt).toContain("終了: 2026-09-17T08:30:00.000Z");
    expect(systemPrompt).toContain("経過時間: -2時間");
  });
});
