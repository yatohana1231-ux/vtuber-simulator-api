import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDynamo, type FakeDynamo } from "./fakeDynamo.js";
import { loadScenarios, resolveScenarioDatetimes } from "./scenarios.js";
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

async function loadSample(fn: Scenario["function"]): Promise<Scenario> {
  const scenarios = await loadScenarios();
  const scenario = scenarios.find((s) => s.function === fn && s.id === "sample-basic");
  if (!scenario) throw new Error(`sample scenario not found for ${fn}`);
  return resolveScenarioDatetimes(scenario, new Date());
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
