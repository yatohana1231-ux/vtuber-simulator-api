import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/debugCharacterState/index.js", () => ({
  runDebugCharacterState: vi.fn(),
}));

import { handler } from "../../../src/handlers/debugCharacterState.js";
import { runDebugCharacterState } from "../../../src/debugCharacterState/index.js";
import type {
  DebugCharacterStateRequest,
  DebugCharacterStateResponse,
} from "../../../src/types.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRun = vi.mocked(runDebugCharacterState);

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

const validMood = {
  joy: 50,
  anxiety: 40,
  angry: 20,
  fatigue: 30,
  confidence: 60,
  loneliness: 10,
};

const validPerception = {
  trust: 70,
  affection: 60,
  respect: 80,
  fear: 10,
  dependence: 30,
  familiarity: 65,
};

const dummyResult: DebugCharacterStateResponse = {
  mood: validMood,
  perception: validPerception,
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック: characterId/packageId", () => {
  it("characterId未指定 → 400でrunDebugCharacterStateは呼ばれない", async () => {
    const res = (await handler(makeEvent({}))) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("bodyがJSONとして壊れている → 400 invalid JSON body", async () => {
    const res = (await handler({ body: "{bad" })) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid JSON body" });
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
});

describe("入力チェック: mood/perceptionの検証", () => {
  const cases: Array<{ name: string; body: Record<string, unknown>; error: string }> = [
    {
      name: "moodがオブジェクトでない（文字列）",
      body: { characterId: "c1", mood: "not-an-object" },
      error: "mood must be an object",
    },
    {
      name: "moodが配列",
      body: { characterId: "c1", mood: [1, 2, 3] },
      error: "mood must be an object",
    },
    {
      name: "moodがnull（指定なしではなく400）",
      body: { characterId: "c1", mood: null },
      error: "mood must be an object",
    },
    {
      name: "moodの項目が不足（loneliness欠落）",
      body: {
        characterId: "c1",
        mood: { joy: 50, anxiety: 40, angry: 20, fatigue: 30, confidence: 60 },
      },
      error: "mood must have exactly the fields: joy, anxiety, angry, fatigue, confidence, loneliness",
    },
    {
      name: "moodに余分な項目がある",
      body: { characterId: "c1", mood: { ...validMood, extra: 1 } },
      error: "mood must have exactly the fields: joy, anxiety, angry, fatigue, confidence, loneliness",
    },
    {
      name: "moodの値が数値でない（文字列）",
      body: { characterId: "c1", mood: { ...validMood, joy: "50" } },
      error: "mood.joy must be an integer",
    },
    {
      name: "moodの値が整数でない（小数）",
      body: { characterId: "c1", mood: { ...validMood, joy: 50.5 } },
      error: "mood.joy must be an integer",
    },
    {
      name: "moodの値が範囲外（0）",
      body: { characterId: "c1", mood: { ...validMood, joy: 0 } },
      error: "mood.joy must be between 1 and 100",
    },
    {
      name: "moodの値が範囲外（101）",
      body: { characterId: "c1", mood: { ...validMood, joy: 101 } },
      error: "mood.joy must be between 1 and 100",
    },
    {
      name: "perceptionがオブジェクトでない",
      body: { characterId: "c1", perception: 123 },
      error: "perception must be an object",
    },
    {
      name: "perceptionの項目が不足",
      body: { characterId: "c1", perception: { trust: 50 } },
      error:
        "perception must have exactly the fields: trust, affection, respect, fear, dependence, familiarity",
    },
    {
      name: "perceptionの値が範囲外（負の数）",
      body: { characterId: "c1", perception: { ...validPerception, trust: -1 } },
      error: "perception.trust must be between 1 and 100",
    },
  ];

  for (const { name, body, error } of cases) {
    it(`${name} → 400 "${error}"`, async () => {
      const res = (await handler(makeEvent(body))) as LambdaResponse;

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error });
      expect(mockedRun).not.toHaveBeenCalled();
    });
  }
});

describe("run*への引数の詰め替え", () => {
  it("mood/perceptionともに未指定 → undefinedのまま渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.characterId).toBe("c1");
    expect(req.mood).toBeUndefined();
    expect(req.perception).toBeUndefined();
  });

  it("moodのみ指定 → moodだけ渡り、perceptionはundefinedのまま", async () => {
    await handler(makeEvent({ characterId: "c1", mood: validMood }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.mood).toEqual(validMood);
    expect(req.perception).toBeUndefined();
  });

  it("perceptionのみ指定 → perceptionだけ渡り、moodはundefinedのまま", async () => {
    await handler(makeEvent({ characterId: "c1", perception: validPerception }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.perception).toEqual(validPerception);
    expect(req.mood).toBeUndefined();
  });

  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のcharacterが渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.character.key).toBe("yui");
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きで { mood, perception } がbodyになる", async () => {
    const res = (await handler(makeEvent({ characterId: "c1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(res.body)).toEqual(dummyResult);
  });

  it("runDebugCharacterStateが例外を投げる → 500でerrorName/errorMessageが入る", async () => {
    mockedRun.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(makeEvent({ characterId: "c1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});
