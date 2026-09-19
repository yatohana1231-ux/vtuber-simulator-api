import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/memoryRetriever/index.js", () => ({
  runMemoryRetriever: vi.fn(),
}));

import { handler } from "../../../src/handlers/memoryRetriever.js";
import { runMemoryRetriever } from "../../../src/memoryRetriever/index.js";
import type {
  MemoryRetrieverRequest,
  MemoryRetrieverRequestProcess1,
  MemoryRetrieverRequestProcess2,
} from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runMemoryRetriever);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(undefined);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunMemoryRetrieverは呼ばれない", async () => {
    const res = (await handler(
      makeEvent({ process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("bodyがJSONとして壊れている → 400 invalid JSON body（F-018）", async () => {
    const res = (await handler({ body: "{bad" })) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid JSON body" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("characterIdが文字列以外（数値） → 400 characterId must be a non-empty string（F-018）", async () => {
    const res = (await handler(
      makeEvent({ characterId: 12345, process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("process未指定 → 400 process must be 1 or 2", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("processが3 → 400 process must be 1 or 2", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: 3 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('processが文字列"1" → 400 process must be 1 or 2（数値の1とは区別される）', async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: "1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("packageIdが存在しないID → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: 1, packageId: "no-such-package" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("packageIdが形式不正 → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: 1, packageId: "../x" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("run*への引数の詰め替え", () => {
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のworld/characterが渡る", async () => {
    await handler(makeEvent({ characterId: "c1", process: 1 }));

    const req = mockedRun.mock.calls[0][0] as MemoryRetrieverRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
  });

  describe("process 1", () => {
    it("eventsとactionsが送られても、runMemoryRetrieverへの引数に渡らない", async () => {
      const events = ["イベントA"];
      const actions = [
        { startDatetime: "s", endDatetime: "e", action: "行動", memo: "メモ" },
      ];
      await handler(
        makeEvent({ characterId: "c1", process: 1, events, actions })
      );

      const req = mockedRun.mock.calls[0][0] as MemoryRetrieverRequestProcess1;
      expect(req).not.toHaveProperty("events");
      expect(req).not.toHaveProperty("actions");
      expect(req.process).toBe(1);
    });
  });

  describe("process 2", () => {
    it("events/actionsは渡さない（processと必須フィールドのみ）", async () => {
      await handler(
        makeEvent({
          characterId: "c1",
          process: 2,
          events: ["無視されるはず"],
          actions: ["無視されるはず"],
        })
      );

      const req = mockedRun.mock.calls[0][0] as MemoryRetrieverRequestProcess2;
      expect(req).not.toHaveProperty("events");
      expect(req).not.toHaveProperty("actions");
      expect(req.process).toBe(2);
    });
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きで { ok: true } がbodyになる（runの戻り値は使わない）", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("runMemoryRetrieverが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
    mockedRun.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(
      makeEvent({ characterId: "c1", process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});
