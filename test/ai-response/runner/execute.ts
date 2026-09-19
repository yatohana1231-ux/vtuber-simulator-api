// -------------------------------------------------------
// 1回の実行（シナリオ × モデル × 繰り返しの1回）
//
// パッケージを読み、characterId を発番し、偽の DynamoDB（fakeDynamo）に状態を投入し、
// 機能ごとにハンドラーと同じ形でリクエストを組み立てて対象の run* を呼ぶ。
// モデルは環境変数 BEDROCK_MODEL_ID を呼び出し直前に設定して切り替える
// （bedrock.ts は呼び出し時点の値を読むため。concurrency で並行実行するのは
// 常に同じモデルの実行だけにすること）。
//
// 本番コード（dynamo.ts・packages.ts・各 run*）は、CONTENT_DIR 等の環境変数を
// 設定したあとに呼び出し元（cli.ts）が動的 import したものを ProductionModules として
// 受け取る（このファイル自身は本番コードを静的 import しない）。
// -------------------------------------------------------

import { randomUUID } from "node:crypto";

import * as bedrockRecorder from "./bedrockRecorder.js";
import { calculateRunCost } from "./cost.js";
import { selectWritesForCharacter, type FakeDynamo } from "./fakeDynamo.js";
import type { ModelCallRecord, ModelPrice, RunResult, Scenario, ScenarioRequest } from "./types.js";

import type { CharacterPackage } from "../../../src/types.js";

// -------------------------------------------------------
// 本番コード（動的 import 済みのもの）
// -------------------------------------------------------

export interface ProductionModules {
  loadPackage: (packageId: string) => Promise<CharacterPackage | null>;
  DEFAULT_PACKAGE_ID: string;
  dynamo: typeof import("../../../src/lib/dynamo.js");
  runAbsenceSimulator: typeof import("../../../src/absenceSimulator/index.js")["runAbsenceSimulator"];
  runDialogueGenerator: typeof import("../../../src/dialogueGenerator/index.js")["runDialogueGenerator"];
  runEmotionUpdater: typeof import("../../../src/emotionUpdater/index.js")["runEmotionUpdater"];
  runMemoryRetriever: typeof import("../../../src/memoryRetriever/index.js")["runMemoryRetriever"];
}

export interface ExecuteRunArgs {
  /** resolveScenarioDatetimes 済み（相対日時がすべて ISO8601 に解決されている）シナリオ */
  scenario: Scenario;
  modelKey: string;
  modelId: string;
  repeatIndex: number;
  fakeDynamo: FakeDynamo;
  modules: ProductionModules;
  pricing: Record<string, ModelPrice>;
}

function emptyUsage(): ModelCallRecord["usage"] {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
}

function sumUsage(calls: ModelCallRecord[]): ModelCallRecord["usage"] {
  return calls.reduce((acc, call) => {
    acc.inputTokens += call.usage.inputTokens;
    acc.outputTokens += call.usage.outputTokens;
    acc.cacheReadInputTokens += call.usage.cacheReadInputTokens;
    acc.cacheWriteInputTokens += call.usage.cacheWriteInputTokens;
    return acc;
  }, emptyUsage());
}

function formatError(e: unknown): string {
  const err = e as { name?: string; message?: string } | undefined;
  return `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`;
}

/** ハンドラー（src/handlers/*.ts）と同じ形でリクエストを組み立て、対象の run* を呼ぶ */
async function callRunFunction(
  scenario: Scenario,
  characterId: string,
  pkg: CharacterPackage,
  modules: ProductionModules
): Promise<unknown> {
  const { world, character, lifestyle } = pkg;

  switch (scenario.function) {
    case "absenceSimulator": {
      const req = scenario.request as Extract<ScenarioRequest, { lastLoginAt: string }>;
      return modules.runAbsenceSimulator({
        characterId,
        world,
        character,
        lifestyle,
        lastLoginAt: req.lastLoginAt,
        now: req.now,
      });
    }
    case "dialogueGenerator": {
      const req = scenario.request as Extract<ScenarioRequest, { message: string }>;
      return modules.runDialogueGenerator({
        characterId,
        world,
        character,
        now: req.now ?? new Date().toISOString(),
        message: req.message,
        mood: req.mood,
        perception: req.perception,
        longTimeFlag: req.longTimeFlag,
      });
    }
    case "emotionUpdater": {
      const req = scenario.request as { process: 1 | 2; playerMessage?: string };
      if (req.process === 1) {
        return modules.runEmotionUpdater({ characterId, world, character, process: 1 });
      }
      return modules.runEmotionUpdater({
        characterId,
        world,
        character,
        process: 2,
        playerMessage: req.playerMessage ?? "",
      });
    }
    case "memoryRetriever": {
      const req = scenario.request as { process: 1 | 2 };
      if (req.process === 1) {
        return modules.runMemoryRetriever({ characterId, world, character, process: 1 });
      }
      return modules.runMemoryRetriever({ characterId, world, character, process: 2 });
    }
    default: {
      const exhaustiveCheck: never = scenario.function;
      throw new Error(`execute: unknown function: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * 1回の実行（シナリオ × モデル × 繰り返しの1回）を行い、RunResult を返す
 * （checks は空配列のまま。判定は runner/checks/index.ts の runChecks が別途行う）。
 */
export async function executeRun(args: ExecuteRunArgs): Promise<RunResult> {
  const { scenario, modelKey, modelId, repeatIndex, fakeDynamo, modules, pricing } = args;

  const characterId = `ai-test-${randomUUID()}`;

  const pkg = await modules.loadPackage(scenario.packageId ?? modules.DEFAULT_PACKAGE_ID);
  if (!pkg) {
    throw new Error(`execute: unknown packageId: ${JSON.stringify(scenario.packageId)}`);
  }

  fakeDynamo.seed(characterId, scenario.state ?? {});

  // bedrock.ts は呼び出し時点の環境変数を読むため、run* を呼ぶ直前に設定する。
  process.env.BEDROCK_MODEL_ID = modelId;

  bedrockRecorder.start();
  const startedAt = Date.now();

  let output: unknown;
  let error: string | undefined;
  try {
    output = await callRunFunction(scenario, characterId, pkg, modules);
  } catch (e) {
    error = formatError(e);
  }

  const totalLatencyMs = Date.now() - startedAt;
  const modelCalls = bedrockRecorder.stop();
  const writes = selectWritesForCharacter(fakeDynamo.writes, characterId);
  const usage = sumUsage(modelCalls);

  return {
    scenarioId: scenario.id,
    function: scenario.function,
    modelKey,
    modelId,
    repeatIndex,
    output,
    error,
    modelCalls,
    writes,
    checks: [],
    metrics: {
      totalLatencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      costUsd: calculateRunCost(modelCalls, pricing),
    },
  };
}
