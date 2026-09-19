import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDynamo, type FakeDynamo } from "./fakeDynamo.js";
import { resolveScenarioDatetimes } from "./scenarios.js";
import type { ProductionModules } from "./execute.js";
import type { Scenario } from "./types.js";

// テストのたびに resetModules で dynamo.ts・packages.ts・各 run*・bedrockRecorder.ts を
// 作り直す（env の設定を反映させるため、および BedrockRuntimeClient のクラス参照を
// vi.spyOn の対象と一致させるため）。

let executeModule: typeof import("./execute.js");
let dynamoModule: typeof import("../../../src/lib/dynamo.js");
let modules: ProductionModules;
let fake: FakeDynamo;
let responseText: string;

async function fakeConverse(): Promise<{
  output: { message: { content: Array<{ text: string }> } };
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number };
}> {
  return {
    output: { message: { content: [{ text: responseText }] } },
    usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  };
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  vi.stubEnv("CONVERSATION_LOGS_TABLE", "test-conversation-logs");
  vi.stubEnv("CHARACTER_MEMORY_TABLE", "test-character-memory");
  vi.stubEnv("EVENTS_TABLE", "test-events");
  vi.resetModules();

  responseText = "{}";

  const bedrockRuntime = await import("@aws-sdk/client-bedrock-runtime");
  vi.spyOn(bedrockRuntime.BedrockRuntimeClient.prototype, "send").mockImplementation(fakeConverse as never);

  const fakeDynamoModule = await import("./fakeDynamo.js");
  executeModule = await import("./execute.js");
  dynamoModule = await import("../../../src/lib/dynamo.js");
  const packagesModule = await import("../../../src/lib/packages.js");
  const absenceSimulatorModule = await import("../../../src/absenceSimulator/index.js");
  const dialogueGeneratorModule = await import("../../../src/dialogueGenerator/index.js");
  const emotionUpdaterModule = await import("../../../src/emotionUpdater/index.js");
  const memoryRetrieverModule = await import("../../../src/memoryRetriever/index.js");

  modules = {
    loadPackage: packagesModule.loadPackage,
    DEFAULT_PACKAGE_ID: packagesModule.DEFAULT_PACKAGE_ID,
    dynamo: dynamoModule,
    runAbsenceSimulator: absenceSimulatorModule.runAbsenceSimulator,
    runDialogueGenerator: dialogueGeneratorModule.runDialogueGenerator,
    runEmotionUpdater: emotionUpdaterModule.runEmotionUpdater,
    runMemoryRetriever: memoryRetrieverModule.runMemoryRetriever,
  };

  fake = fakeDynamoModule.createFakeDynamo();
  fake.install(dynamoModule);
});

afterEach(() => {
  fake.uninstall();
});

// executeRun 自体の動作（呼び出し回数・writes の件数など）を確かめるための、最小限の
// インラインシナリオ（以前の scenarios/<機能名>/sample-basic.json 相当）。
// scenarios/ の実ファイルはシナリオそのものの内容（本番用）で今後も増減・変更されるため、
// この仕組みのテストはそれに左右されないよう、ここに直接持つ。
const SAMPLE_SCENARIOS: Record<Scenario["function"], Scenario> = {
  absenceSimulator: {
    id: "inline-sample-absence-simulator",
    function: "absenceSimulator",
    description: "30時間の不在（sample-basic 相当）",
    request: { lastLoginAt: "now-30h", now: "now" },
  },
  dialogueGenerator: {
    id: "inline-sample-dialogue-generator",
    function: "dialogueGenerator",
    description: "挨拶への返答（sample-basic 相当）",
    request: { message: "こんにちは" },
  },
  emotionUpdater: {
    id: "inline-sample-emotion-updater",
    function: "emotionUpdater",
    description: "process=2。やさしい発言（sample-basic 相当）",
    request: { process: 2, playerMessage: "今日もがんばったね、えらいよ" },
  },
  memoryRetriever: {
    id: "inline-sample-memory-retriever",
    function: "memoryRetriever",
    description: "process=2。会話ログ10件（user/assistant 交互、未判定）（sample-basic 相当）",
    state: {
      conversationLogs: Array.from({ length: 10 }, (_, i) => ({
        index: `now-${(10 - i) * 5}m`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: i % 2 === 0 ? `プレイヤーの発言${Math.floor(i / 2) + 1}` : `キャラクターの返答${Math.floor(i / 2) + 1}`,
        memoryRetrieverJudgedFlag: 0,
      })),
    },
    request: { process: 2 },
  },
};

function loadSample(fn: Scenario["function"]): Scenario {
  return resolveScenarioDatetimes(SAMPLE_SCENARIOS[fn], new Date());
}

describe("executeRun", () => {
  it("absenceSimulator: run* が動き、RunResultが埋まる", async () => {
    const scenario = await loadSample("absenceSimulator");

    const result = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("events");
    expect(result.output).toHaveProperty("actions");
    expect(result.modelCalls).toHaveLength(1);
    expect(result.modelCalls[0].modelId).toBe("test-model-id");
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.checks).toEqual([]);
  });

  it("dialogueGenerator: run* が動き、RunResultが埋まる", async () => {
    const scenario = await loadSample("dialogueGenerator");

    const result = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("{}");
    expect(result.modelCalls).toHaveLength(1);
    expect(result.modelCalls[0].modelId).toBe("test-model-id");
    // saveConversationLog がプレイヤー発言・キャラクターの返答の2回呼ばれる
    expect(result.writes).toHaveLength(2);
  });

  it("emotionUpdater: run* が動き、RunResultが埋まる", async () => {
    const scenario = await loadSample("emotionUpdater");

    const result = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toHaveProperty("mood");
    expect(result.output).toHaveProperty("perception");
    expect(result.modelCalls).toHaveLength(1);
    expect(result.modelCalls[0].modelId).toBe("test-model-id");
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].table).toBe("characterMemory");
  });

  it("memoryRetriever: run* が動き、RunResultが埋まる", async () => {
    const scenario = await loadSample("memoryRetriever");

    const result = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.modelCalls).toHaveLength(1);
    expect(result.modelCalls[0].modelId).toBe("test-model-id");
    // markLogsAsJudged による update が10件（会話ログ10件分）記録される
    expect(result.writes.filter((w) => w.operation === "update")).toHaveLength(10);
  });

  it("run* が例外を投げたら error に入り、それまでの書き込みは残る", async () => {
    const scenario = await loadSample("dialogueGenerator");

    const bedrockRuntime = await import("@aws-sdk/client-bedrock-runtime");
    vi.spyOn(bedrockRuntime.BedrockRuntimeClient.prototype, "send").mockImplementationOnce(() =>
      Promise.reject(new Error("boom"))
    );

    const result = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result.error).toMatch(/boom/);
    expect(result.output).toBeUndefined();
    expect(result.modelCalls).toHaveLength(1);
    expect(result.modelCalls[0].error).toMatch(/boom/);
    // プレイヤー発言の保存だけは例外の前に完了している
    expect(result.writes).toHaveLength(1);
  });

  it("modelごとにcharacterIdが異なり、writesが混ざらない", async () => {
    const scenario = await loadSample("dialogueGenerator");

    const result1 = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 0,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });
    const result2 = await executeModule.executeRun({
      scenario,
      modelKey: "test-model",
      modelId: "test-model-id",
      repeatIndex: 1,
      fakeDynamo: fake,
      modules,
      pricing: {},
    });

    expect(result1.writes).toHaveLength(2);
    expect(result2.writes).toHaveLength(2);
    // 2回分の書き込みが fake.writes に累積している
    expect(fake.writes.length).toBeGreaterThanOrEqual(4);
  });
});
