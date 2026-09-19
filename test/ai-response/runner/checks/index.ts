// -------------------------------------------------------
// ルールによる判定の入り口。
//
// シナリオの checks（{ type, params }[]）を、登録された判定関数で評価する。
// 個々の判定は機能ごとにファイルを分けている
// （common.ts / absenceSimulator.ts / dialogueGenerator.ts / emotionUpdater.ts / memoryRetriever.ts）。
// -------------------------------------------------------

import type { CheckResult, RunResult, Scenario } from "../types.js";
import type { CheckContext, CheckFn } from "./types.js";
import { jsonParsed, modelResponded, noModelCall } from "./common.js";
import {
  actionsMatchedByIndex,
  eventCountMatchesSkeleton,
  noDuplicateThreads,
  noRepeatOfRecentEvents,
  slotActionMustNotContain,
  threadContinued,
} from "./absenceSimulator.js";
import {
  maxLength,
  mustMentionAny,
  mustNotMention,
  noAiDisclosure,
  noForbiddenElements,
  politenessStyle,
} from "./dialogueGenerator.js";
import { deltaDirection, deltaWithin } from "./emotionUpdater.js";
import { savedCount, savedMustMentionAny, savedMustNotMention } from "./memoryRetriever.js";

export type { CheckContext } from "./types.js";

const REGISTRY: Record<string, CheckFn> = {
  // 共通
  modelResponded,
  jsonParsed,
  noModelCall,
  // dialogueGenerator
  maxLength,
  noForbiddenElements,
  noAiDisclosure,
  mustMentionAny,
  mustNotMention,
  politenessStyle,
  // absenceSimulator
  eventCountMatchesSkeleton,
  actionsMatchedByIndex,
  slotActionMustNotContain,
  noRepeatOfRecentEvents,
  noDuplicateThreads,
  threadContinued,
  // emotionUpdater
  deltaDirection,
  deltaWithin,
  // memoryRetriever
  savedCount,
  savedMustMentionAny,
  savedMustNotMention,
};

/**
 * scenario.checks の各 { type, params } を評価する。
 * - result.error があるときは、どの判定も不合格にする（detail に error）。
 * - 未知の type は不合格（detail: "unknown check type"）。
 * - 判定関数が例外を投げても（本来は投げない方針だが）ここで捕まえ、不合格にする。
 */
export function runChecks(scenario: Scenario, result: RunResult, context: CheckContext): CheckResult[] {
  const specs = scenario.checks ?? [];

  return specs.map((spec): CheckResult => {
    if (result.error) {
      return { type: spec.type, passed: false, detail: `run* が例外を投げた: ${result.error}` };
    }

    const fn = REGISTRY[spec.type];
    if (!fn) {
      return { type: spec.type, passed: false, detail: "unknown check type" };
    }

    try {
      const outcome = fn(result, context, spec.params);
      return { type: spec.type, passed: outcome.passed, detail: outcome.detail };
    } catch (e) {
      return { type: spec.type, passed: false, detail: `判定中に例外が起きた: ${(e as Error).message}` };
    }
  });
}
