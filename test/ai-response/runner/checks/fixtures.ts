// -------------------------------------------------------
// checks/*.test.ts・report.test.ts で使う、手組みのテストフィクスチャ。
// vitest の対象パターン（*.test.ts）に含まれないよう、ファイル名に .test を付けない。
// -------------------------------------------------------

import type {
  CharacterDefinition,
  Lifestyle,
  World,
} from "../../../../src/types.js";
import type { CheckContext } from "./types.js";
import type { ModelCallRecord, RunResult, Scenario, TargetFunction } from "../types.js";

export function makeWorld(overrides: Partial<World> = {}): World {
  return {
    key: "test-world",
    name: "テスト世界観",
    description: "テスト用の世界観",
    rules: [],
    forbiddenElements: ["暴力的な描写", "政治的な発言"],
    timezone: "Asia/Tokyo",
    ...overrides,
  };
}

export function makeCharacter(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    key: "test-character",
    name: "テストちゃん",
    personality: "元気",
    speechStyle: "タメ口",
    relationship: "友達",
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
    ...overrides,
  };
}

export function makeLifestyle(overrides: Partial<Lifestyle> = {}): Lifestyle {
  return {
    key: "test-lifestyle",
    schedules: {
      weekday: [
        { start: "00:00", end: "07:00", activity: "就寝" },
        { start: "07:00", end: "08:00", activity: "朝の準備" },
        { start: "08:00", end: "16:00", activity: "学校" },
        { start: "16:00", end: "24:00", activity: "自由時間" },
      ],
      holiday: [
        { start: "00:00", end: "09:00", activity: "就寝" },
        { start: "09:00", end: "24:00", activity: "自由時間" },
      ],
    },
    eventKinds: [
      { key: "daily", label: "日常", weight: 1 },
      { key: "special", label: "特別", weight: 1 },
    ],
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "test-scenario",
    function: "dialogueGenerator",
    description: "テスト用のシナリオ",
    request: { message: "こんにちは" },
    checks: [],
    ...overrides,
  };
}

export function makeContext(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    world: makeWorld(),
    character: makeCharacter(),
    lifestyle: makeLifestyle(),
    resolvedScenario: makeScenario(),
    ...overrides,
  };
}

export function makeModelCall(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    modelId: "test-model",
    systemPrompt: ["system"],
    userMessage: "user",
    responseText: "```json\n{}\n```",
    latencyMs: 100,
    usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    ...overrides,
  };
}

export function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  const functionName: TargetFunction = overrides.function ?? "dialogueGenerator";
  return {
    scenarioId: "test-scenario",
    function: functionName,
    modelKey: "test-model-key",
    modelId: "test-model-id",
    repeatIndex: 0,
    output: undefined,
    error: undefined,
    modelCalls: [],
    writes: [],
    checks: [],
    metrics: {
      totalLatencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      costUsd: null,
    },
    ...overrides,
  };
}
