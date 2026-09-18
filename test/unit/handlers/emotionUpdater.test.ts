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
  mood: { joy: 52, anxiety: 45, angry: 15, fatigue: 38, confidence: 35, loneliness: 8 },
  perception: { trust: 74, affection: 58, respect: 80, fear: 10, dependence: 32, familiarity: 68 },
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunEmotionUpdaterは呼ばれない", async () => {
    const res = (await handler(
      makeEvent({ process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "characterId is required" });
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

    const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
  });

  describe("process 1", () => {
    it("eventsとactionsが配列 → そのまま渡る", async () => {
      const events = ["イベントA"];
      const actions = [
        { startDatetime: "s", endDatetime: "e", action: "行動", memo: "メモ" },
      ];
      await handler(
        makeEvent({ characterId: "c1", process: 1, events, actions })
      );

      const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequestProcess1;
      expect(req.events).toEqual(events);
      expect(req.actions).toEqual(actions);
    });

    it("eventsとactionsが配列でない（省略） → 空配列が渡る", async () => {
      await handler(makeEvent({ characterId: "c1", process: 1 }));

      const req = mockedRun.mock.calls[0][0] as EmotionUpdaterRequestProcess1;
      expect(req.events).toEqual([]);
      expect(req.actions).toEqual([]);
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
  it("成功時 → 200かつCORSヘッダー付きで { mood, perception } がbodyになる", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", process: 1 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual(dummyResult);
  });

  it("runEmotionUpdaterが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
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
