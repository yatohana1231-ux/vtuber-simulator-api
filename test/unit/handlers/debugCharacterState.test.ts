import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/debugCharacterState/index.js", () => ({
  runDebugCharacterState: vi.fn(),
}));

import { handler } from "../../../src/handlers/debugCharacterState.js";
import { runDebugCharacterState } from "../../../src/debugCharacterState/index.js";
import { EMOTION_KEYS } from "../../../src/types.js";
import type {
  DebugCharacterStateRequest,
  DebugCharacterStateResponse,
  Emotions,
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

function validEmotions(overrides: Partial<Emotions> = {}): Emotions {
  const base = Object.fromEntries(EMOTION_KEYS.map((key) => [key, 10])) as Emotions;
  return { ...base, ...overrides };
}

const validMood = { pleasure: 20, arousal: -10, dominance: 5 };

const validPerception = {
  trust: 70,
  affection: 60,
  respect: 80,
  fear: 10,
  dependence: 30,
  familiarity: 65,
};

const dummyResult: DebugCharacterStateResponse = {
  emotions: validEmotions(),
  mood: validMood,
  needs: { fatigue: 30, loneliness: 20 },
  perception: validPerception,
  pendingSession: null,
  stage: { key: "first", label: "はじめまして", maxPerception: {} },
  affectUpdatedAt: "2026-09-10T00:00:00.000Z",
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRun.mockResolvedValue(dummyResult);
});

describe("入力チェック: characterId/packageId/now", () => {
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

  it("nowが不正な形式 → 400 invalid now format", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", now: "not-a-date" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid now format" });
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("now省略 → 400にならず現在時刻でrunDebugCharacterStateが呼ばれる", async () => {
    const res = (await handler(makeEvent({ characterId: "c1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(new Date(req.now).getTime()).not.toBeNaN();
  });
});

describe("入力チェック: emotions/mood/needs/perceptionの検証", () => {
  const cases: Array<{ name: string; body: Record<string, unknown>; error: string }> = [
    {
      name: "emotionsがオブジェクトでない（文字列）",
      body: { characterId: "c1", emotions: "not-an-object" },
      error: "emotions must be an object",
    },
    {
      name: "emotionsが配列",
      body: { characterId: "c1", emotions: [1, 2, 3] },
      error: "emotions must be an object",
    },
    {
      name: "emotionsがnull（指定なしではなく400）",
      body: { characterId: "c1", emotions: null },
      error: "emotions must be an object",
    },
    {
      name: "emotionsの項目が不足（sympathy欠落）",
      body: {
        characterId: "c1",
        emotions: Object.fromEntries(
          EMOTION_KEYS.filter((key) => key !== "sympathy").map((key) => [key, 10])
        ),
      },
      error: `emotions must have exactly the fields: ${EMOTION_KEYS.join(", ")}`,
    },
    {
      name: "emotionsに余分な項目がある",
      body: { characterId: "c1", emotions: { ...validEmotions(), extra: 1 } },
      error: `emotions must have exactly the fields: ${EMOTION_KEYS.join(", ")}`,
    },
    {
      name: "emotionsの値が数値でない（文字列）",
      body: { characterId: "c1", emotions: { ...validEmotions(), joy: "50" } },
      error: "emotions.joy must be a number",
    },
    {
      name: "emotionsの値が範囲外（負の数）",
      body: { characterId: "c1", emotions: { ...validEmotions(), joy: -1 } },
      error: "emotions.joy must be between 0 and 100",
    },
    {
      name: "emotionsの値が範囲外（101）",
      body: { characterId: "c1", emotions: { ...validEmotions(), joy: 101 } },
      error: "emotions.joy must be between 0 and 100",
    },
    {
      name: "moodがオブジェクトでない",
      body: { characterId: "c1", mood: 123 },
      error: "mood must be an object",
    },
    {
      name: "moodの項目が不足（dominance欠落）",
      body: { characterId: "c1", mood: { pleasure: 0, arousal: 0 } },
      error: "mood must have exactly the fields: pleasure, arousal, dominance",
    },
    {
      name: "moodに余分な項目がある",
      body: { characterId: "c1", mood: { ...validMood, extra: 1 } },
      error: "mood must have exactly the fields: pleasure, arousal, dominance",
    },
    {
      name: "moodの値が範囲外（-101）",
      body: { characterId: "c1", mood: { ...validMood, pleasure: -101 } },
      error: "mood.pleasure must be between -100 and 100",
    },
    {
      name: "moodの値が範囲外（101）",
      body: { characterId: "c1", mood: { ...validMood, pleasure: 101 } },
      error: "mood.pleasure must be between -100 and 100",
    },
    {
      name: "needsがオブジェクトでない",
      body: { characterId: "c1", needs: "not-an-object" },
      error: "needs must be an object",
    },
    {
      name: "needsにlonelinessが無い",
      body: { characterId: "c1", needs: {} },
      error: "needs must include field: loneliness",
    },
    {
      name: "needsに知らない項目がある",
      body: { characterId: "c1", needs: { loneliness: 10, extra: 1 } },
      error: "needs has an unknown field: extra",
    },
    {
      name: "needs.lonelinessが数値でない",
      body: { characterId: "c1", needs: { loneliness: "10" } },
      error: "needs.loneliness must be a number",
    },
    {
      name: "needs.lonelinessが範囲外（101）",
      body: { characterId: "c1", needs: { loneliness: 101 } },
      error: "needs.loneliness must be between 0 and 100",
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
    {
      name: "perceptionの値が範囲外（0）",
      body: { characterId: "c1", perception: { ...validPerception, trust: 0 } },
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

  it("emotionsが小数値でも400にならない", async () => {
    const res = (await handler(
      makeEvent({ characterId: "c1", emotions: { ...validEmotions(), joy: 12.5 } })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(mockedRun).toHaveBeenCalled();
  });

  it("needs.fatigueを指定しても400にならず無視される（loneliness以外はrunDebugCharacterStateに渡らない）", async () => {
    await handler(makeEvent({ characterId: "c1", needs: { loneliness: 10, fatigue: 999 } }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.needs).toEqual({ loneliness: 10 });
  });
});

describe("run*への引数の詰め替え", () => {
  it("emotions/mood/needs/perceptionすべて未指定 → undefinedのまま渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.characterId).toBe("c1");
    expect(req.emotions).toBeUndefined();
    expect(req.mood).toBeUndefined();
    expect(req.needs).toBeUndefined();
    expect(req.perception).toBeUndefined();
  });

  it("emotionsのみ指定 → emotionsだけ渡り、ほかはundefinedのまま", async () => {
    const emotions = validEmotions();
    await handler(makeEvent({ characterId: "c1", emotions }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.emotions).toEqual(emotions);
    expect(req.mood).toBeUndefined();
    expect(req.needs).toBeUndefined();
    expect(req.perception).toBeUndefined();
  });

  it("now指定 → ISO8601文字列に正規化されてrunDebugCharacterStateに渡る", async () => {
    await handler(makeEvent({ characterId: "c1", now: "2026-09-10T12:00:00+09:00" }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.now).toBe(new Date("2026-09-10T12:00:00+09:00").toISOString());
  });

  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)のworld/character/lifestyleが渡る", async () => {
    await handler(makeEvent({ characterId: "c1" }));

    const req = mockedRun.mock.calls[0][0] as DebugCharacterStateRequest;
    expect(req.character.key).toBe("yui");
    expect(req.world).toBeDefined();
    expect(req.lifestyle).toBeDefined();
  });
});

describe("レスポンス", () => {
  it("成功時 → 200かつCORSヘッダー付きでrunDebugCharacterStateの結果がbodyになる", async () => {
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
