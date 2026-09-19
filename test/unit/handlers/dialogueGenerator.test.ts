import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/dialogueGenerator/index.js", () => ({
  runDialogueGenerator: vi.fn(),
}));

import { handler } from "../../../src/handlers/dialogueGenerator.js";
import { runDialogueGenerator } from "../../../src/dialogueGenerator/index.js";
import type { DialogueGeneratorRequest } from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runDialogueGenerator);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

const dummyReply = "え、本当ですか！？ありがとうございます！";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyReply);
});

describe("入力チェック", () => {
  it("characterId未指定 → 400でrunDialogueGeneratorは呼ばれない", async () => {
    const res = (await handler(makeEvent({}))) as LambdaResponse;

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
      makeEvent({ characterId: 12345 })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("nowが不正な日時文字列 → 400 invalid now format", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", now: "not-a-date" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid now format" });
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

  it("packageIdが形式不正 → 400 unknown packageId", async () => {
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

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req.world.key).toBe("modern-tokyo");
    expect(req.character.key).toBe("yui");
  });

  it("nowを渡す → ISO8601文字列に正規化されて渡る", async () => {
    await handler(
      makeEvent({ characterId: "c1", now: "2026-08-11T14:30:00" })
    );

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
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

      const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
      expect(req.now).toBe("2026-09-17T00:00:00.000Z");
    });
  });

  it("messageを渡す → そのまま渡る", async () => {
    await handler(makeEvent({ characterId: "c1", message: "こんにちは" }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req.message).toBe("こんにちは");
  });

  it("message省略 → 空文字が渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req.message).toBe("");
  });

  it("mood/perceptionを送っても、runDialogueGeneratorへの引数に含まれない（D-032で廃止）", async () => {
    const mood = { joy: 1, anxiety: 2, angry: 3, fatigue: 4, confidence: 5, loneliness: 6 };
    const perception = { trust: 1, affection: 2, respect: 3, fear: 4, dependence: 5, familiarity: 6 };

    await handler(makeEvent({ characterId: "c1", mood, perception }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req).not.toHaveProperty("mood");
    expect(req).not.toHaveProperty("perception");
  });

  it("eventsとactionsを送っても、runDialogueGeneratorへの引数に含まれない（D-022で廃止）", async () => {
    const events = ["イベントA"];
    const actions = [
      { startDatetime: "s", endDatetime: "e", action: "行動", memo: "メモ" },
    ];

    await handler(makeEvent({ characterId: "c1", events, actions }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req).not.toHaveProperty("events");
    expect(req).not.toHaveProperty("actions");
  });

  it("longTimeFlagを渡す → そのまま渡る", async () => {
    await handler(makeEvent({ characterId: "c1", longTimeFlag: 1 }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req.longTimeFlag).toBe(1);
  });

  it("longTimeFlag省略 → undefinedのまま渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DialogueGeneratorRequest;
    expect(req.longTimeFlag).toBeUndefined();
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きで { reply } がbodyになる", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual({ reply: dummyReply });
  });

  it("runDialogueGeneratorが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
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
