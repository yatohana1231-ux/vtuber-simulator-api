// -------------------------------------------------------
// checks/ 内で共有する型。
// -------------------------------------------------------

import type { RunResult, Scenario } from "../types.js";
import type { CharacterDefinition, Lifestyle, World } from "../../../../src/types.js";

/** 判定に必要な、シナリオ由来の付随情報 */
export interface CheckContext {
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  resolvedScenario: Scenario;
}

/** 判定関数は type を除いた結果（passed/detail）を返す。type は呼び出し側（index.ts）が付ける */
export interface CheckOutcome {
  passed: boolean;
  detail?: string;
}

/**
 * 1つの判定の実装。例外は投げない方針（呼び出し側の runChecks でも念のため捕まえる）。
 * params は未検証の値（Scenario.checks[].params）として渡ってくるので、各実装が検証する。
 */
export type CheckFn = (
  result: RunResult,
  context: CheckContext,
  params: Record<string, unknown> | undefined
) => CheckOutcome;
