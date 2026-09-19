import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/absenceSimulator/index.js", () => ({
  runAbsenceSimulator: vi.fn(),
}));

import { handler } from "../../../src/handlers/absenceSimulator.js";
import { runAbsenceSimulator } from "../../../src/absenceSimulator/index.js";
import type { AbsenceSimulatorRequest, AbsenceSimulatorResult } from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runAbsenceSimulator);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

const dummyResult: AbsenceSimulatorResult = {
  startDatetime: "2026-08-10T10:00:00.000Z",
  endDatetime: "2026-08-11T14:30:00.000Z",
  events: [
    {
      kind: "school",
      summary: "テストで赤点を取って補修が大変だった",
      detail: "追試の勉強で放課後残された",
    },
  ],
  actions: [
    {
      startDatetime: "2026-08-10T10:00:00.000Z",
      endDatetime: "2026-08-10T11:00:00.000Z",
      action: "起床・身支度",
      memo: "",
    },
  ],
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunAbsenceSimulatorは呼ばれない", async () => {
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

  it("nowがlastLoginAtより前 → 400でrunAbsenceSimulatorは呼ばれない", async () => {
    const res = (await handler(
      makeEvent({
        characterId: "c1",
        lastLoginAt: "2026-08-11T14:30:00.000Z",
        now: "2026-08-10T10:00:00.000Z",
      })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "lastLoginAt must not be later than now",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("nowとlastLoginAtが同時刻 → 200", async () => {
    const res = (await handler(
      makeEvent({
        characterId: "c1",
        lastLoginAt: "2026-08-10T10:00:00.000Z",
        now: "2026-08-10T10:00:00.000Z",
      })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("packageIdが存在しないID → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", packageId: "no-such-package" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("packageIdが形式不正（大文字を含む） → 400 unknown packageId", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", packageId: "Yui-Modern-Tokyo" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("run*への引数の詰め替え", () => {
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のworld/character/lifestyleが渡る", async () => {
    await handler(
      makeEvent({
        characterId: "c1",
        lastLoginAt: "2026-08-10T10:00:00.000Z",
        now: "2026-08-11T14:30:00.000Z",
      })
    );

    const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
    expect(req.lifestyle.key).toBe("tokyo-highschool-vtuber");
  });

  it("渡るlifestyleは既定パッケージの生活様式で、worldはtimezoneを持つ", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
    expect(req.lifestyle.key).toBe("tokyo-highschool-vtuber");
    expect(typeof req.world.timezone).toBe("string");
    expect(req.world.timezone.length).toBeGreaterThan(0);
  });

  it("lastLoginAt省略 → nowと同値が渡る", async () => {
    await handler(
      makeEvent({ characterId: "c1", now: "2026-08-11T14:30:00.000Z" })
    );

    const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
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

    const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
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

      const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
      expect(req.now).toBe("2026-09-17T00:00:00.000Z");
      expect(req.lastLoginAt).toBe("2026-09-17T00:00:00.000Z");
    });

    it("lastLoginAtだけ指定してnow省略、lastLoginAtが未来になる場合 → 400", async () => {
      const res = (await handler(
        makeEvent({ characterId: "c1", lastLoginAt: "2026-09-18T00:00:00.000Z" })
      )) as LambdaResponse;

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: "lastLoginAt must not be later than now",
      });
      expect(mockedRun).not.toHaveBeenCalled();
    });
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きでrunAbsenceSimulatorの結果がそのままbodyになる", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual(dummyResult);
  });

  it("runAbsenceSimulatorが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
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

describe("契約とのずれの確認", () => {
  it("bodyがJSONとして壊れている → 400ではなく500になる（現状の挙動）", async () => {
    const res = (await handler({ body: "{bad" })) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("Failed to generate a response");
    expect(parsed.errorName).toBe("SyntaxError");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("characterIdが文字列以外（truthyな数値） → 型チェックされず素通りする（現状の挙動）", async () => {
    const res = (await handler(
      makeEvent({ characterId: 12345 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    const req = mockedRun.mock.calls[0][0] as AbsenceSimulatorRequest;
    expect(req.characterId as unknown).toBe(12345);
  });
});
