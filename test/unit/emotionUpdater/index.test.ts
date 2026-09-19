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
    getLatestAbsenceRecord: vi.fn(),
  };
});

import { runEmotionUpdater } from "../../../src/emotionUpdater/index.js";
import { invokeModelJson } from "../../../src/lib/bedrock.js";
import {
  getCharacterState,
  saveCharacterState,
  getLatestAbsenceRecord,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../../../src/lib/dynamo.js";
import { formatLocalDateTime } from "../../../src/lib/timezone.js";
import type {
  AbsenceRecord,
  CharacterDefinition,
  EmotionUpdaterRequest,
  Mood,
  Perception,
  World,
} from "../../../src/types.js";

const mockedInvokeModelJson = vi.mocked(invokeModelJson);
const mockedGetCharacterState = vi.mocked(getCharacterState);
const mockedSaveCharacterState = vi.mocked(saveCharacterState);
const mockedGetLatestAbsenceRecord = vi.mocked(getLatestAbsenceRecord);

const world: World = {
  key: "test-world",
  name: "テスト世界",
  description: "emotionUpdaterテスト用の世界観マーカー",
  rules: [],
  forbiddenElements: [],
  timezone: "Asia/Tokyo",
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "",
  speechStyle: "",
  relationship: "",
  background: "",
  speechExamples: [],
  initialPerception: {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 10,
    dependence: 10,
    familiarity: 50,
  },
  relationshipStages: [
    {
      key: "first",
      label: "テスト段階",
      description: "テスト用の説明",
      speechStyle: "テスト用の話し方",
      speechExamples: [],
      promoteWhen: null,
    },
  ],
};

function process1Req(overrides: Partial<EmotionUpdaterRequest> = {}): EmotionUpdaterRequest {
  return {
    characterId: "char-1",
    world,
    character,
    process: 1,
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

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-08-11T08:00:00.000Z",
    startDatetime: "2026-08-11T00:00:00.000Z",
    endDatetime: "2026-08-11T08:00:00.000Z",
    events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }],
    actions: [
      {
        startDatetime: "2026-08-11T06:00:00.000Z",
        endDatetime: "2026-08-11T07:00:00.000Z",
        action: "朝食を食べた",
        memo: "眠そう",
      },
    ],
    threads: [],
    ...overrides,
  };
}

/** invokeModelJson に渡ったシステムプロンプト（層の配列）を1つの文字列に結合して返す */
function joinedPrompt(callIndex = 0): string {
  const systemPrompt = mockedInvokeModelJson.mock.calls[callIndex][0];
  return Array.isArray(systemPrompt) ? systemPrompt.join("\n") : systemPrompt;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  mockedGetCharacterState.mockResolvedValue({ mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } });
  mockedSaveCharacterState.mockResolvedValue(undefined);
  mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord());
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

describe("getCharacterStateの呼び出し（D-033: 初期値にcharacter.initialPerceptionを渡す）", () => {
  it("characterIdとcharacter.initialPerceptionでgetCharacterStateが呼ばれる", async () => {
    await runEmotionUpdater(process1Req({ characterId: "char-xyz" }));

    expect(mockedGetCharacterState).toHaveBeenCalledWith("char-xyz", character.initialPerception);
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

describe("process1: 最新の不在期間の記録（D-022）", () => {
  it("記録が無い → LLMを呼ばず、保存もせず、現在の状態をそのまま返す", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(null);
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    const currentPerception: Perception = { trust: 72, affection: 55, respect: 80, fear: 12, dependence: 30, familiarity: 65 };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: currentPerception });

    const result = await runEmotionUpdater(process1Req());

    expect(mockedInvokeModelJson).not.toHaveBeenCalled();
    expect(mockedSaveCharacterState).not.toHaveBeenCalled();
    expect(result.mood).toEqual(currentMood);
    expect(result.perception).toEqual(currentPerception);
  });

  it("記録がある → characterIdでgetLatestAbsenceRecordが呼ばれる", async () => {
    await runEmotionUpdater(process1Req({ characterId: "char-xyz" }));

    expect(mockedGetLatestAbsenceRecord).toHaveBeenCalledWith("char-xyz");
  });

  it("記録の出来事のsummary・detailと、「±0〜3」のルールがプロンプトに入る", async () => {
    mockedGetLatestAbsenceRecord.mockResolvedValue(
      absenceRecord({ events: [{ kind: "daily", summary: "雨が降った", detail: "傘を忘れて濡れた" }] })
    );

    await runEmotionUpdater(process1Req());

    const prompt = joinedPrompt();
    expect(prompt).toContain("雨が降った");
    expect(prompt).toContain("傘を忘れて濡れた");
    expect(prompt).toContain("±0〜3");
  });

  it("記録の行動の日時が、世界観のタイムゾーン表記で入る（UTCのslice(0,16)ではない）", async () => {
    const action = {
      startDatetime: "2026-08-11T06:00:00.000Z",
      endDatetime: "2026-08-11T07:00:00.000Z",
      action: "朝食を食べた",
      memo: "眠そう",
    };
    mockedGetLatestAbsenceRecord.mockResolvedValue(absenceRecord({ actions: [action] }));

    await runEmotionUpdater(process1Req());

    const prompt = joinedPrompt();
    const start = formatLocalDateTime(new Date(action.startDatetime), world.timezone);
    const end = formatLocalDateTime(new Date(action.endDatetime), world.timezone);
    expect(prompt).toContain(`${start}〜${end} ${action.action}（${action.memo}）`);
    expect(prompt).not.toContain(action.startDatetime.slice(0, 16));
  });

  it("invokeModelJsonに層の配列（[固定部, 可変部]）が渡る", async () => {
    await runEmotionUpdater(process1Req());

    const systemPrompt = mockedInvokeModelJson.mock.calls[0][0];
    expect(Array.isArray(systemPrompt)).toBe(true);
    expect(systemPrompt).toHaveLength(2);
  });
});

describe("process2: プレイヤー発言と変化幅のルール", () => {
  it("プレイヤーの発言、「±1〜5」のルールがプロンプトに入る", async () => {
    await runEmotionUpdater(process2Req({ playerMessage: "今日は調子どう？" }));

    const prompt = joinedPrompt();
    expect(prompt).toContain("今日は調子どう？");
    expect(prompt).toContain("±1〜5");
  });

  it("getLatestAbsenceRecordを呼ばない", async () => {
    await runEmotionUpdater(process2Req());

    expect(mockedGetLatestAbsenceRecord).not.toHaveBeenCalled();
  });
});

describe("mood/perceptionのラベルと段階", () => {
  it("境界値 20/21 → 「ほとんど感じない」から「低い」に切り替わる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 20, anxiety: 21, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });

    await runEmotionUpdater(process1Req());

    const prompt = joinedPrompt();
    expect(prompt).toContain("喜び：20（ほとんど感じない）");
    expect(prompt).toContain("不安：21（低い）");
  });

  it("境界値 60/61 → 「標準」から「自覚している」に切り替わる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 60, anxiety: 61, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });

    await runEmotionUpdater(process1Req());

    const prompt = joinedPrompt();
    expect(prompt).toContain("喜び：60（標準）");
    expect(prompt).toContain("不安：61（自覚している）");
  });
});

describe("モデルの差分が数値でない場合（F-019）", () => {
  // invokeModelJson は Bedrock の JSON 出力をそのまま返すだけで実行時の型チェックは行わない。
  // 数値でない値（数字の文字列・null・NaN・Infinity・オブジェクト等）は
  // applyDelta 側で弾き、0（変化なし）として扱うことで current + delta が
  // 文字列連結や NaN にならないようにする（F-019）。
  it.each([
    ["数字の文字列\"5\"", "5" as unknown as number],
    ["マイナスを表す文字列\"-5\"", "-5" as unknown as number],
    ["null", null as unknown as number],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["オブジェクト", { foo: "bar" } as unknown as number],
  ])("差分が%s → 無効な値として無視され現在値のまま変わらない", async (_label, invalidValue) => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: invalidValue },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(35);
    expect(Number.isNaN(result.mood.joy)).toBe(false);
  });

  it("同じ差分内の正しい数値の項目（数値の joy）は無効な項目（文字列の anxiety）とは別に適用される", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: 5, anxiety: "3" as unknown as number },
      perceptionDelta: {},
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood.joy).toBe(40);
    expect(result.mood.anxiety).toBe(62);
  });

  it("不正な値のとき console.warn が項目名・値とともに呼ばれる", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: "5" as unknown as number },
      perceptionDelta: {},
    });

    await runEmotionUpdater(process1Req());

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("moodDelta.joy"),
      "5"
    );
  });

  it("項目が省略されている（undefined）場合は console.warn が呼ばれない", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: {},
      perceptionDelta: {},
    });

    await runEmotionUpdater(process1Req());

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("perceptionDelta 側でも同様に無効な値は現在値のまま変わらない", async () => {
    const currentPerception: Perception = {
      trust: 72,
      affection: 55,
      respect: 80,
      fear: 12,
      dependence: 30,
      familiarity: 65,
    };
    mockedGetCharacterState.mockResolvedValue({
      mood: { ...DEFAULT_MOOD },
      perception: currentPerception,
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: {},
      perceptionDelta: { trust: "3" as unknown as number, affection: 5 },
    });

    const result = await runEmotionUpdater(process1Req());

    expect(result.perception.trust).toBe(72);
    expect(result.perception.affection).toBe(60);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("perceptionDelta.trust"),
      "3"
    );
  });

  it("モデルの応答全体がnull → 例外にならず現在値のまま保存される", async () => {
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    const currentPerception: Perception = {
      trust: 72,
      affection: 55,
      respect: 80,
      fear: 12,
      dependence: 30,
      familiarity: 65,
    };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: currentPerception });
    mockedInvokeModelJson.mockResolvedValueOnce(null as never);

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood).toEqual(currentMood);
    expect(result.perception).toEqual(currentPerception);
    expect(mockedSaveCharacterState).toHaveBeenCalledWith("char-1", currentMood, currentPerception);
  });

  it.each([
    ["配列", [1, 2, 3] as unknown],
    ["文字列", "not-an-object" as unknown],
  ])("moodDeltaが%sのとき現在値のまま変わらない", async (_label, invalidMoodDelta) => {
    const currentMood: Mood = { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 };
    mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: { ...DEFAULT_PERCEPTION } });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: invalidMoodDelta,
      perceptionDelta: {},
    } as never);

    const result = await runEmotionUpdater(process1Req());

    expect(result.mood).toEqual(currentMood);
  });

  it("saveCharacterStateにNaNが渡らない（不正な差分が混ざっていても保存値はすべて有限の数値）", async () => {
    mockedGetCharacterState.mockResolvedValue({
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { ...DEFAULT_PERCEPTION },
    });
    mockedInvokeModelJson.mockResolvedValueOnce({
      moodDelta: { joy: "-5" as unknown as number, anxiety: NaN, angry: Infinity },
      perceptionDelta: { trust: null as unknown as number },
    });

    await runEmotionUpdater(process1Req());

    expect(mockedSaveCharacterState).toHaveBeenCalledTimes(1);
    const [, savedMood, savedPerception] = mockedSaveCharacterState.mock.calls[0];
    for (const value of Object.values(savedMood)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of Object.values(savedPerception)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
