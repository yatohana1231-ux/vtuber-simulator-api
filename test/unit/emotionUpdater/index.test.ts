import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/bedrock.js", () => ({
  invokeModelJson: vi.fn(),
}));

vi.mock("../../../src/lib/dynamo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/dynamo.js")>();
  return {
    ...actual,
    getCharacterState: vi.fn(),
    saveCharacterState: vi.fn(),
  };
});

import { runEmotionUpdater } from "../../../src/emotionUpdater/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import { getCharacterState, saveCharacterState, DEFAULT_MOOD, DEFAULT_PERCEPTION } from "../../../src/lib/dynamo.js";
import type {
  Action,
  CharacterDefinition,
  EmotionUpdaterRequest,
  Mood,
  Perception,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetCharacterState = vi.mocked(getCharacterState);
const mockedSaveCharacterState = vi.mocked(saveCharacterState);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "emotionUpdaterテスト用の世界観マーカー",
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

function process1Req(overrides: Partial<EmotionUpdaterRequest> = {}): EmotionUpdaterRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 1,
    events: [],
    actions: [],
    ...overrides,
  } as EmotionUpdaterRequest;
}

function process2Req(overrides: Partial<EmotionUpdaterRequest> = {}): EmotionUpdaterRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 2,
    playerMessage: "こんにちは",
    ...overrides,
  } as EmotionUpdaterRequest;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
  mockedSaveCharacterState.mockResolvedValue(undefined);
  mockedInvokeModelJson.mockImplementation(async (_systemPrompt, _userMessage, fallback) => fallback);
});

describe("差分の適用と1〜100への丸め", () => {
  it("差分を足した値がそのまま範囲内 → 加算結果になる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 5 },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(40);
  });

  it("上限を超える差分 → 100に丸められる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 95, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 20 },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(100);
  });

  it("下限を下回る差分 → 1に丸められる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 5, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: -20 },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(1);
  });

  it("小数の差分 → 四捨五入される", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 2.5 },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    // 35 + 2.5 = 37.5 → Math.round は 38 に丸める
    expect(result.mood.joy).toBe(38);
  });
});

describe("差分に無い項目", () => {
  it("moodDeltaに含まれない項目は現在値のまま変わらない", async () => {
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: { ...DEFAULT_PERCEPTION } });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 5 },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.anxiety).toBe(62);
    expect(result.mood.angry).toBe(20);
    expect(result.mood.fatigue).toBe(48);
    expect(result.mood.confidence).toBe(30);
    expect(result.mood.loneliness).toBe(10);
  });
});

describe("moodDelta/perceptionDelta自体が無い・fallback", () => {
  it("fallback（invokeModelJsonが第3引数をそのまま返す） → 現在値のまま", async () => {
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    const currentPerception: Perception = { trust: 72, affection: 55, respect: 80, fear: 12, dependence: 30, familiarity: 65 };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: currentPerception });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood).toEqual(currentMood);
    expect(result.perception).toEqual(currentPerception);
  });

  it("moodDelta/perceptionDeltaキー自体が応答に無い → 現在値のまま", async () => {
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: { ...DEFAULT_PERCEPTION } });
    mockedInvokeModelJson.mockResolvedValueOnce({} as never);

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood).toEqual(currentMood);
  });
});

describe("DynamoDBに状態が無い場合", () => {
  it("既定値（DEFAULT_MOOD/DEFAULT_PERCEPTION）から差分を計算する", async () => {
    // getCharacterState自体は既定値へのフォールバックを内部で行うため、
    // ここではそのモックが既定値を返す形で確認する（getCharacterState自体のテストはlib/dynamo.test.tsが担当）
    mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 5 },
      perceptionDelta: { trust: 3 },
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(DEFAULT_MOOD.joy + 5);
    expect(result.perception.trust).toBe(DEFAULT_PERCEPTION.trust + 3);
  });
});

describe("saveCharacterStateへの保存", () => {
  it("更新後の値がcharacterIdとともに渡る", async () => {
    mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 5 },
      perceptionDelta: { trust: 3 },
    });

    const result = await runEmotionUpdater(process1Req({ characterId: "char-xyz" }));

    expect(mockedSaveCharacterState).toHaveBeenCalledTimes(1);
    expect(mockedSaveCharacterState).toHaveBeenCalledWith("char-xyz", result.mood, result.perception);
  });
});

describe("process1: イベント・行動と変化幅のルール", () => {
  it("eventsとactionsの内容、「±0〜3」のルールがプロンプトに入る", async () => {
    const actions: Action[] = [
      { startDatetime: "2026-08-11T06:00:00.000Z", endDatetime: "2026-08-11T07:00:00.000Z", action: "朝食を食べた", memo: "眠そう" },
    ];
    await runEmotionUpdater(process1Req({ events: ["雨が降った"], actions }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("雨が降った");
    expect(systemPrompt).toContain("朝食を食べた");
    expect(systemPrompt).toContain("±0〜3");
  });

  it("eventsもactionsも空 → 「（なし）」が入る", async () => {
    await runEmotionUpdater(process1Req({ events: [], actions: [] }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("【不在中の出来事】\n（なし）");
    expect(systemPrompt).toContain("【不在中の行動】\n（なし）");
  });
});

describe("process2: プレイヤー発言と変化幅のルール", () => {
  it("プレイヤーの発言、「±1〜5」のルールがプロンプトに入る", async () => {
    await runEmotionUpdater(process2Req({ playerMessage: "今日は調子どう？" }));

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("今日は調子どう？");
    expect(systemPrompt).toContain("±1〜5");
  });
});

describe("mood/perceptionのラベルと段階", () => {
  it("境界値 20/21 → 「ほとんど感じない」から「低い」に切り替わる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 20, anxiety: 21, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });

    await runEmotionUpdater(process1Req());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("喜び：20（ほとんど感じない）");
    expect(systemPrompt).toContain("不安：21（低い）");
  });

  it("境界値 60/61 → 「標準」から「自覚している」に切り替わる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 60, anxiety: 61, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });

    await runEmotionUpdater(process1Req());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(systemPrompt).toContain("喜び：60（標準）");
    expect(systemPrompt).toContain("不安：61（自覚している）");
  });
});

describe("現状の挙動の確認（モデルの差分が数値でない場合）", () => {
  // moodDelta/perceptionDelta は型上 Partial<Record<..., number>> だが、
  // invokeModelJson は Bedrock の JSON 出力をそのまま T として返すだけで実行時の型チェックは行わない。
  // 数値でない値が来ると `current + delta` が文字列連結になり、Math.round 後の
  // clamp（Math.max/Math.min）で意図しない値になる。
  it("差分が数字の文字列\"5\" → 文字列連結された上でclampされ100になる（35+\"5\"=\"355\"）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: "5" as unknown as number },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    // 期待される「35+5=40」ではなく、"35"+"5"="355" → clampで100になる
    expect(result.mood.joy).toBe(100);
  });

  it("差分がマイナスを表す文字列\"-5\" → 数値化に失敗しNaNになる（35+\"-5\"=\"35-5\"はNumberでNaN）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: "-5" as unknown as number },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBeNaN();
  });

  it("差分がnull → 加算時に0として扱われ現在値のまま変わらない（意図せず「変化なし」に見える）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: null as unknown as number },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(35);
  });
});
