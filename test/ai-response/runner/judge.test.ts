import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildJudgeSystemPrompt, buildJudgeUserMessage, shouldJudge, type JudgeRunArgs } from "./judge.js";
import { makeCharacter, makeContext, makeModelCall, makeRunResult, makeScenario } from "./checks/fixtures.js";
import type { ModelPrice, RubricCriterion } from "./types.js";

// judgeRun は src/lib/bedrock.ts 経由で BedrockRuntimeClient.prototype.send を呼び、
// bedrockRecorder.ts がその prototype を差し替えて呼び出しを記録する。bedrockRecorder は
// 「最初に呼ばれた時点の send」だけを一度だけラップする作りなので、テストごとに
// vi.resetModules() してから @aws-sdk/client-bedrock-runtime・./judge.js を取り直し、
// スパイを設定してから import することで、毎回まっさらな状態で記録できるようにする
// （execute.test.ts と同じパターン）。

type SendResult = {
  output: { message: { content: Array<{ text: string }> } };
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number };
};

interface ConverseCommandLike {
  input: {
    modelId?: string;
    system?: unknown[];
    messages?: unknown[];
    inferenceConfig?: { temperature?: number; maxTokens?: number };
  };
}

const CRITERIA: RubricCriterion[] = [
  {
    id: "characterVoice",
    name: "キャラクターらしさ",
    description: "口調の例文と比べて言葉選びが一致しているか。",
    anchors: { 5: "完全に一致", 3: "おおむね一致", 1: "明らかに異なる" },
  },
  {
    id: "conversationalNaturalness",
    name: "会話としての自然さ",
    description: "応答として成立しているか。",
    anchors: { 5: "自然", 3: "やや機械的", 1: "成立していない" },
  },
];

const JUDGE_MODEL_ID = "judge.model.id";
const JUDGE_PRICING: Record<string, ModelPrice> = {
  [JUDGE_MODEL_ID]: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

function mockSendResult(text: string, usage?: Partial<{ inputTokens: number; outputTokens: number }>): SendResult {
  return {
    output: { message: { content: [{ text }] } },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, ...usage },
  };
}

function validJudgeResponseText(): string {
  return JSON.stringify({
    scores: {
      characterVoice: { score: 5, reason: "口調が一致している" },
      conversationalNaturalness: { score: 3, reason: "やや機械的" },
    },
    comment: "全体として良い出力",
  });
}

const DIALOGUE_SCENARIO = makeScenario({
  function: "dialogueGenerator",
  description: "初対面の挨拶シナリオ",
  judgeFocus: ["丁寧語で話すか"],
  request: { message: "はじめまして" },
});
const DIALOGUE_CONTEXT = makeContext({ resolvedScenario: DIALOGUE_SCENARIO });
const DIALOGUE_RESULT = makeRunResult({
  function: "dialogueGenerator",
  modelKey: "nova-lite",
  modelId: "apac.amazon.nova-lite-v1:0",
  output: "はじめまして、よろしくお願いします。",
  modelCalls: [makeModelCall()],
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("buildJudgeSystemPrompt", () => {
  it("評価基準の全観点（id・名前・説明・5/3/1の目安）が入る", () => {
    const prompt = buildJudgeSystemPrompt(CRITERIA);
    for (const c of CRITERIA) {
      expect(prompt).toContain(c.id);
      expect(prompt).toContain(c.name);
      expect(prompt).toContain(c.description);
      expect(prompt).toContain(c.anchors[5]);
      expect(prompt).toContain(c.anchors[3]);
      expect(prompt).toContain(c.anchors[1]);
    }
  });

  it("JSON形式の出力指示が入る", () => {
    const prompt = buildJudgeSystemPrompt(CRITERIA);
    expect(prompt).toContain("scores");
    expect(prompt).toContain("comment");
  });

  it("対象外のルールと、その出力例（score: null）が入る", () => {
    const prompt = buildJudgeSystemPrompt(CRITERIA);
    expect(prompt).toContain("対象外");
    expect(prompt).toContain("評価する材料が無い場合");
    expect(prompt).toContain('"score": null');
  });
});

describe("buildJudgeUserMessage", () => {
  it("dialogueGenerator: シナリオの説明・judgeFocus・出力（reply）が入り、モデル名は入らない", () => {
    const message = buildJudgeUserMessage(DIALOGUE_SCENARIO, DIALOGUE_RESULT, DIALOGUE_CONTEXT);

    expect(message).toContain("初対面の挨拶シナリオ");
    expect(message).toContain("丁寧語で話すか");
    expect(message).toContain("はじめまして、よろしくお願いします。");
    expect(message).not.toContain("nova-lite");
    expect(message).not.toContain("apac.amazon.nova-lite-v1:0");
  });

  it("dialogueGenerator: state.relationship.stageKey に合う段階の説明・話し方・例文が入る（キャラクター共通の例文ではない）", () => {
    const character = makeCharacter({
      name: "テストちゃん",
      speechExamples: [{ player: "共通の例文", reply: "共通の返答" }],
      relationshipStages: [
        {
          key: "first",
          label: "はじめまして段階",
          description: "最初の段階の説明",
          speechStyle: "最初の段階の話し方",
          speechExamples: [{ player: "最初の例文", reply: "最初の返答" }],
          promoteWhen: null,
        },
        {
          key: "close",
          label: "仲良し段階",
          description: "仲良し段階の説明",
          speechStyle: "仲良し段階の話し方",
          speechExamples: [{ player: "仲良しの例文", reply: "仲良しの返答" }],
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: {} },
        },
      ],
    });
    const scenario = makeScenario({
      function: "dialogueGenerator",
      description: "仲良し段階のシナリオ",
      request: { message: "今日どうだった？" },
      state: {
        relationship: {
          firstMetAt: "2026-01-01T00:00:00.000Z",
          lastConversationAt: "2026-01-13T00:00:00.000Z",
          lastConversationDate: "2026-01-13",
          conversationCount: 42,
          conversationDays: 10,
          stageKey: "close",
          highestStageKey: "close",
          recoveryRemaining: 0,
          lastDemotedAt: null,
          updatedAt: "2026-01-13T00:00:00.000Z",
        },
      },
    });
    const context = makeContext({ character, resolvedScenario: scenario });
    const result = makeRunResult({ function: "dialogueGenerator", output: "今日は楽しかったよ" });

    const message = buildJudgeUserMessage(scenario, result, context);

    expect(message).toContain("仲良し段階の説明");
    expect(message).toContain("仲良し段階の話し方");
    expect(message).toContain("仲良しの例文");
    expect(message).not.toContain("最初の段階の説明");
    // 「今の関係の段階」の口調の例文には、段階の例文だけが入り、
    // キャラクター共通の例文（## キャラクター 側に別途入るもの）は入らない
    const stageSection = message.slice(message.indexOf("今の関係の段階"), message.indexOf("感情値"));
    expect(stageSection).not.toContain("共通の例文");
  });

  it("dialogueGenerator: state.relationship が無い → 先頭の段階（最初の段階）を使う", () => {
    const character = makeCharacter({
      relationshipStages: [
        {
          key: "first",
          label: "はじめまして段階",
          description: "最初の段階の説明",
          speechStyle: "最初の段階の話し方",
          speechExamples: [],
          promoteWhen: null,
        },
        {
          key: "close",
          label: "仲良し段階",
          description: "仲良し段階の説明",
          speechStyle: "仲良し段階の話し方",
          speechExamples: [],
          promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: {} },
        },
      ],
    });
    const scenario = makeScenario({ function: "dialogueGenerator", request: { message: "はじめまして" } });
    const context = makeContext({ character, resolvedScenario: scenario });
    const result = makeRunResult({ function: "dialogueGenerator", output: "よろしくお願いします" });

    const message = buildJudgeUserMessage(scenario, result, context);

    expect(message).toContain("最初の段階の説明");
    expect(message).not.toContain("仲良し段階の説明");
  });

  it("dialogueGenerator: 段階の口調の例文が空 → キャラクター共通の例文を使う", () => {
    const character = makeCharacter({
      speechExamples: [{ player: "共通の例文", reply: "共通の返答" }],
      relationshipStages: [
        {
          key: "first",
          label: "はじめまして段階",
          description: "最初の段階の説明",
          speechStyle: "最初の段階の話し方",
          speechExamples: [],
          promoteWhen: null,
        },
      ],
    });
    const scenario = makeScenario({ function: "dialogueGenerator", request: { message: "こんにちは" } });
    const context = makeContext({ character, resolvedScenario: scenario });
    const result = makeRunResult({ function: "dialogueGenerator", output: "こんにちは" });

    const message = buildJudgeUserMessage(scenario, result, context);

    expect(message).toContain("共通の例文");
  });

  it("absenceSimulator: 出力の行動の時刻が世界観のタイムゾーン表記で入る", () => {
    const scenario = makeScenario({
      function: "absenceSimulator",
      description: "休日の日中の不在",
      request: { lastLoginAt: "2026-09-19T00:00:00.000Z", now: "2026-09-19T03:00:00.000Z" },
    });
    const context = makeContext({ resolvedScenario: scenario });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: {
        startDatetime: "2026-09-19T00:00:00.000Z",
        endDatetime: "2026-09-19T03:00:00.000Z",
        events: [{ kind: "daily", summary: "散歩した", detail: "近所を散歩した" }],
        actions: [
          {
            startDatetime: "2026-09-19T00:00:00.000Z",
            endDatetime: "2026-09-19T01:00:00.000Z",
            action: "散歩",
            memo: "",
          },
        ],
      },
    });

    const message = buildJudgeUserMessage(scenario, result, context);

    // Asia/Tokyo は UTC+9 なので 2026-09-19T00:00:00Z は 09:00
    expect(message).toContain("09:00");
    expect(message).toContain("散歩した");
  });

  it("emotionUpdater: 更新前後の値と差分が入る", () => {
    const scenario = makeScenario({
      function: "emotionUpdater",
      description: "やさしい発言",
      request: { process: 2, playerMessage: "いつもありがとう" },
      state: {
        mood: { joy: 50, anxiety: 50, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
        perception: { trust: 50, affection: 50, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
      },
    });
    const context = makeContext({ resolvedScenario: scenario });
    const result = makeRunResult({
      function: "emotionUpdater",
      output: {
        mood: { joy: 60, anxiety: 50, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
        perception: { trust: 55, affection: 55, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
      },
    });

    const message = buildJudgeUserMessage(scenario, result, context);

    expect(message).toContain("いつもありがとう");
    expect(message).toContain("joy:+10");
    expect(message).toContain("trust:+5");
  });

  it("memoryRetriever: 保存が0件なら「保存無し」と書く", () => {
    const scenario = makeScenario({
      function: "memoryRetriever",
      description: "雑談のみ",
      request: { process: 2 },
    });
    const context = makeContext({ resolvedScenario: scenario });
    const result = makeRunResult({ function: "memoryRetriever", writes: [] });

    const message = buildJudgeUserMessage(scenario, result, context);

    expect(message).toContain("保存無し");
  });

  it("judgeFocusが無い場合は「指定なし」と書く", () => {
    const scenario = makeScenario({ judgeFocus: undefined });
    const context = makeContext({ resolvedScenario: scenario });
    const result = makeRunResult();

    const message = buildJudgeUserMessage(scenario, result, context);
    expect(message).toContain("（指定なし）");
  });
});

describe("judgeRun", () => {
  let judgeModule: typeof import("./judge.js");
  let sendSpy: ReturnType<typeof vi.fn>;
  let responseText: string;
  let usageOverride: Partial<{ inputTokens: number; outputTokens: number }> | undefined;
  let rejectWith: Error | null;

  beforeEach(async () => {
    vi.resetModules();
    responseText = validJudgeResponseText();
    usageOverride = undefined;
    rejectWith = null;

    const bedrockRuntime = await import("@aws-sdk/client-bedrock-runtime");
    sendSpy = vi
      .spyOn(bedrockRuntime.BedrockRuntimeClient.prototype, "send")
      .mockImplementation(async () => {
        if (rejectWith) throw rejectWith;
        return mockSendResult(responseText, usageOverride);
      }) as unknown as ReturnType<typeof vi.fn>;

    judgeModule = await import("./judge.js");
  });

  function callJudgeRun(overrides: Partial<JudgeRunArgs> = {}) {
    return judgeModule.judgeRun({
      scenario: DIALOGUE_SCENARIO,
      result: DIALOGUE_RESULT,
      criteria: CRITERIA,
      context: DIALOGUE_CONTEXT,
      judgeModelId: JUDGE_MODEL_ID,
      temperature: 0,
      maxTokens: 1500,
      pricing: JUDGE_PRICING,
      ...overrides,
    });
  }

  it("正常な応答 → 各観点のscore/reasonが入る", async () => {
    const judge = await callJudgeRun();

    expect(judge.error).toBeUndefined();
    expect(judge.judgeModelId).toBe(JUDGE_MODEL_ID);
    expect(judge.scores).toEqual({ characterVoice: 5, conversationalNaturalness: 3 });
    expect(judge.reasons.characterVoice).toBe("口調が一致している");
    expect(judge.reasons.conversationalNaturalness).toBe("やや機械的");
    expect(judge.comment).toBe("全体として良い出力");
    expect(judge.notApplicable).toEqual([]);
  });

  it("modelId・temperatureが指定どおりConverseCommandに送られる", async () => {
    await callJudgeRun({ judgeModelId: JUDGE_MODEL_ID, temperature: 0 });

    const command = sendSpy.mock.calls[0][0] as ConverseCommandLike;
    expect(command.input.modelId).toBe(JUDGE_MODEL_ID);
    expect(command.input.inferenceConfig?.temperature).toBe(0);
  });

  it("システムプロンプトは1層の配列で渡される（[criteria文字列]）", async () => {
    await callJudgeRun();

    const command = sendSpy.mock.calls[0][0] as ConverseCommandLike;
    expect(command.input.system).toHaveLength(1);
    expect(command.input.system?.[0]).toHaveProperty("text");
  });

  it("プロンプトに評価基準・シナリオの説明・出力が入り、比較対象のモデル名は入らない", async () => {
    await callJudgeRun();

    const command = sendSpy.mock.calls[0][0] as ConverseCommandLike;
    const systemText = (command.input.system?.[0] as { text?: string } | undefined)?.text ?? "";
    const userText = ((command.input.messages?.[0] as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]
      ?.text ?? "") as string;

    expect(systemText).toContain("characterVoice");
    expect(systemText).toContain("キャラクターらしさ");
    expect(userText).toContain("初対面の挨拶シナリオ");
    expect(userText).toContain("はじめまして、よろしくお願いします。");
    expect(systemText).not.toContain("nova-lite");
    expect(userText).not.toContain("nova-lite");
    expect(userText).not.toContain("apac.amazon.nova-lite-v1:0");
  });

  it("範囲外の点数（6）→ その観点はnull", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: 6, reason: "満点以上のつもり" },
        conversationalNaturalness: { score: 3, reason: "妥当" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.scores.characterVoice).toBeNull();
    expect(judge.scores.conversationalNaturalness).toBe(3);
    expect(judge.error).toBeUndefined();
  });

  it("小数の点数（3.5）→ その観点はnull", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: 3.5, reason: "中間くらい" },
        conversationalNaturalness: { score: 3, reason: "妥当" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.scores.characterVoice).toBeNull();
  });

  it("理由が無い観点 → reasonは空文字", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: 5 },
        conversationalNaturalness: { score: 3, reason: "妥当" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.reasons.characterVoice).toBe("");
  });

  it("評価基準に無い観点はscores/reasonsに含まれない", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: 5, reason: "良い" },
        conversationalNaturalness: { score: 3, reason: "妥当" },
        unknownCriterion: { score: 5, reason: "無視されるべき" },
      },
    });

    const judge = await callJudgeRun();

    expect(Object.keys(judge.scores).sort()).toEqual(["characterVoice", "conversationalNaturalness"]);
  });

  it("壊れたJSON → errorが入り、scoresはすべてnull", async () => {
    responseText = "JSONではない文章です";

    const judge = await callJudgeRun();

    expect(judge.error).toBeDefined();
    expect(judge.scores).toEqual({ characterVoice: null, conversationalNaturalness: null });
    expect(judge.notApplicable).toEqual([]);
  });

  it("送信が例外を投げる → errorに入り、scoresはすべてnull", async () => {
    rejectWith = new Error("throttled");

    const judge = await callJudgeRun();

    expect(judge.error).toContain("throttled");
    expect(judge.scores).toEqual({ characterVoice: null, conversationalNaturalness: null });
    expect(judge.notApplicable).toEqual([]);
  });

  it("score: null かつ reasonが「対象外」始まり → notApplicableに入り、scoreはnull", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: null, reason: "対象外: 口調を判断する発言が無い" },
        conversationalNaturalness: { score: 3, reason: "妥当" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.notApplicable).toEqual(["characterVoice"]);
    expect(judge.scores.characterVoice).toBeNull();
    expect(judge.reasons.characterVoice).toBe("対象外: 口調を判断する発言が無い");
    expect(judge.scores.conversationalNaturalness).toBe(3);
  });

  it('score: "n/a"（大文字小文字を問わない）かつ理由が対象外始まり → notApplicableに入る', async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: "N/A", reason: "対象外: 話題が無い" },
        conversationalNaturalness: { score: "n/a", reason: "対象外: 材料無し" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.notApplicable.sort()).toEqual(["characterVoice", "conversationalNaturalness"]);
    expect(judge.scores).toEqual({ characterVoice: null, conversationalNaturalness: null });
  });

  it("score: null だが理由が「対象外」で始まらない → 採点できなかった扱い（notApplicableに入らない）", async () => {
    responseText = JSON.stringify({
      scores: {
        characterVoice: { score: null, reason: "判断が難しかった" },
        conversationalNaturalness: { score: 3, reason: "妥当" },
      },
    });

    const judge = await callJudgeRun();

    expect(judge.notApplicable).toEqual([]);
    expect(judge.scores.characterVoice).toBeNull();
    expect(judge.reasons.characterVoice).toBe("判断が難しかった");
  });

  it("料金は採点の呼び出し分だけで計算される（実行本体のmodelCallsは使わない）", async () => {
    usageOverride = { inputTokens: 1000, outputTokens: 200 };

    const judge = await callJudgeRun();

    // (1000/1e6)*5 + (200/1e6)*25 = 0.005 + 0.005 = 0.01
    expect(judge.costUsd).toBeCloseTo(0.01, 10);
  });

  it("料金表に採点モデルが無い → costUsdはnull", async () => {
    const judge = await callJudgeRun({ pricing: {} });

    expect(judge.costUsd).toBeNull();
  });
});

describe("shouldJudge", () => {
  it("errorが無く、modelCallsが1件以上 → true", () => {
    const result = makeRunResult({ error: undefined, modelCalls: [makeModelCall()] });
    expect(shouldJudge(result)).toBe(true);
  });

  it("errorがある → false", () => {
    const result = makeRunResult({ error: "TypeError: boom", modelCalls: [makeModelCall()] });
    expect(shouldJudge(result)).toBe(false);
  });

  it("modelCallsが空 → false（Bedrockを呼ばないシナリオ）", () => {
    const result = makeRunResult({ error: undefined, modelCalls: [] });
    expect(shouldJudge(result)).toBe(false);
  });
});
