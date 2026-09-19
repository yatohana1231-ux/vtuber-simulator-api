import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/emotionUpdater/index.js", () => ({
  runEmotionUpdater: vi.fn(),
}));

import { handler } from "../../../src/handlers/emotionUpdater.js";
import { runEmotionUpdater } from "../../../src/emotionUpdater/index.js";
import type {
  EmotionUpdaterRequest,
  EmotionUpdaterRequestProcess1,
  EmotionUpdaterRequestProcess2,
  EmotionUpdaterResponse,
} from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runEmotionUpdater);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

const dummyResult: EmotionUpdaterResponse = {
  emotions: {
    joy: 10,
    sadness: 0,
    hope: 0,
    anxiety: 0,
    relief: 0,
    disappointment: 0,
    pride: 0,
    shame: 0,
    gratitude: 0,
    admiration: 0,
    anger: 0,
    happyFor: 0,
    sympathy: 0,
  },
  mood: { pleasure: 5, arousal: -3, dominance: 0 },
  needs: { fatigue: 30, loneliness: 5 },
  perception: { trust: 74, affection: 58, respect: 80, fear: 10, dependence: 32, familiarity: 68 },
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunEmotionUpdaterは呼ばれない", async () => {
    const res = (await handler(makeEvent({ process: 1 }))) as LambdaResponse;

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
    const res = (await handler(makeEvent({ characterId: 12345, process: 1 }))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("process未指定 → 400 process must be 1 or 2", async () => {
    const res = (await handler(makeEvent({ characterId: "c1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("processが3 → 400 process must be 1 or 2", async () => {
    const res = (await handler(makeEvent({ characterId: "c1", process: 3 }))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it('processが文字列"1" → 400 process must be 1 or 2（数値の1とは区別される）', async () => {
    const res = (await handler(makeEvent({ characterId: "c1", process: "1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "process must be 1 or 2" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("nowが不正な日時文字列 → 400 invalid now format", async () => {
    const res = (await handler(makeEvent({ characterId: "c1", process: 1, now: "not-a-date" }))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid now format" });
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
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のworld/character/lifestyleが渡る", async () => {
    await handler(makeEvent({ characterId: "c1", process: 1 }));

    const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
    expect(req.lifestyle).toBeDefined();
  });

  it("now省略 → 現在時刻が渡る", async () => {
    const before = Date.now();
    await handler(makeEvent({ characterId: "c1", process: 1 }));
    const after = Date.now();

    const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequest;
    const nowMs = new Date(req.now).getTime();
    expect(nowMs).toBeGreaterThanOrEqual(before);
    expect(nowMs).toBeLessThanOrEqual(after);
  });

  it("nowを指定 → そのままISO8601で渡る", async () => {
    await handler(makeEvent({ characterId: "c1", process: 1, now: "2026-09-19T12:00:00.000Z" }));

    const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequest;
    expect(req.now).toBe("2026-09-19T12:00:00.000Z");
  });

  describe("process 1", () => {
    it("eventsとactionsが送られても、runEmotionUpdaterへの引数に渡らない", async () => {
      const events = ["イベントA"];
      const actions = [{ startDatetime: "s", endDatetime: "e", action: "行動", memo: "メモ" }];
      await handler(makeEvent({ characterId: "c1", process: 1, events, actions }));

      const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequestProcess1;
      expect(req).not.toHaveProperty("events");
      expect(req).not.toHaveProperty("actions");
      expect(req.process).toBe(1);
    });
  });

  describe("process 2", () => {
    it("playerMessageが渡る", async () => {
      await handler(
        makeEvent({
          characterId: "c1",
          process: 2,
          playerMessage: "今日の配信すごく良かったよ",
        })
      );

      const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequestProcess2;
      expect(req.playerMessage).toBe("今日の配信すごく良かったよ");
    });

    it("playerMessage省略 → 空文字が渡る", async () => {
      await handler(makeEvent({ characterId: "c1", process: 2 }));

      const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequestProcess2;
      expect(req.playerMessage).toBe("");
    });
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きで { emotions, mood, needs, perception } がbodyになる", async () => {
    const res = (await handler(makeEvent({ characterId: "c1", process: 1 }))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual(dummyResult);
  });

  it("runEmotionUpdaterが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
    mockedRun.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(makeEvent({ characterId: "c1", process: 1 }))) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});
