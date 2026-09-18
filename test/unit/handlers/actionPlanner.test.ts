import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/actionPlanner/index.js", () => ({
  runActionPlanner: vi.fn(),
}));

import { handler } from "../../../src/handlers/actionPlanner.js";
import { runActionPlanner } from "../../../src/actionPlanner/index.js";
import type { ActionPlannerRequest, ActionPlannerResult } from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runActionPlanner);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

const dummyResult: ActionPlannerResult = {
  actions: [
    {
      startDatetime: "2026-08-11T08:00:00.000Z",
      endDatetime: "2026-08-11T09:30:00.000Z",
      action: "歌の練習",
      memo: "新曲のサビを重点的に練習した",
    },
  ],
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunActionPlannerは呼ばれない", async () => {
    const res = (await handler(makeEvent({}))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "characterId is required" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("lastLoginAtが不正な日時文字列 → 400", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", lastLoginAt: "not-a-date" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "invalid lastLoginAt or now format",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("nowが不正な日時文字列 → 400", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", now: "not-a-date" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "invalid lastLoginAt or now format",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("packageIdが存在しないID → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", packageId: "no-such-package" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("packageIdが形式不正（パストラバーサル） → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", packageId: "../x" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("run*への引数の詰め替え", () => {
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のworld/characterが渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
  });

  it("lastLoginAt省略 → nowと同値が渡る", async () => {
    await handler(
      makeEvent({ characterId: "c1", now: "2026-08-11T14:30:00.000Z" })
    );

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.lastLoginAt).toBe("2026-08-11T14:30:00.000Z");
    expect(req.now).toBe("2026-08-11T14:30:00.000Z");
  });

  it("lastLoginAt/nowともにISO8601文字列に正規化されて渡る", async () => {
    await handler(
      makeEvent({
        characterId: "c1",
        lastLoginAt: "2026-08-10T10:00:00",
        now: "2026-08-11T14:30:00",
      })
    );

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.lastLoginAt).toBe(new Date("2026-08-10T10:00:00").toISOString());
    expect(req.now).toBe(new Date("2026-08-11T14:30:00").toISOString());
  });

  describe("now省略時", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-17T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("サーバー現在時刻が渡る", async () => {
      await handler(makeEvent({ characterId: "c1" }));

      const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
      expect(req.now).toBe("2026-09-17T00:00:00.000Z");
      expect(req.lastLoginAt).toBe("2026-09-17T00:00:00.000Z");
    });
  });

  it("eventsが配列 → そのまま渡る", async () => {
    await handler(
      makeEvent({ characterId: "c1", events: ["イベントA", "イベントB"] })
    );

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.events).toEqual(["イベントA", "イベントB"]);
  });

  it("eventsが配列でない（省略） → 空配列が渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.events).toEqual([]);
  });

  it("eventsが配列でない（文字列） → 空配列が渡る", async () => {
    await handler(makeEvent({ characterId: "c1", events: "not-an-array" }));

    const req = mockedRun.mock.calls[0][0] as ActionPlannerRequest;
    expect(req.events).toEqual([]);
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きでrunActionPlannerの結果がそのままbodyになる", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual(dummyResult);
  });

  it("runActionPlannerが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
    mockedRun.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(
      makeEvent({ characterId: "c1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});
