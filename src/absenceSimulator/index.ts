// -------------------------------------------------------
// absenceSimulator
// 旧 eventResolver（出来事の生成）と actionPlanner（行動履歴の生成）を統合し、
// 不在期間の骨格（buildAbsenceSkeleton, D-018）を組み立てたうえで、LLM に
// 出来事・行動・続きの話題を書かせ、骨格と突き合わせて記録（AbsenceRecord）を
// 保存する（D-020）。LLM の呼び出しが失敗しても、記録の保存とログインの流れは
// 止めない（D-020）。
// -------------------------------------------------------

import { randomUUID } from "crypto";

import { invokeModelJson } from "../lib/bedrock.js";
import {
  getLatestAbsenceRecord,
  getRecentAbsenceRecords,
  getRelevantMemories,
  saveAbsenceRecord,
} from "../lib/dynamo.js";
import { buildAbsenceSkeleton } from "./skeleton.js";
import { buildAbsenceSimulatorPromptLayers } from "./prompt.js";
import {
  buildAbsenceRecord,
  EMPTY_MODEL_OUTPUT,
  selectOpenThreadsForPrompt,
  type AbsenceSimulatorModelOutput,
} from "./modelOutput.js";
import type { AbsenceSimulatorRequest, AbsenceSimulatorResult } from "../types.js";

// -------------------------------------------------------
// 定数
// -------------------------------------------------------

/** 「最近の出来事（繰り返さない）」に使う、直近の記録の件数 */
export const RECENT_ABSENCE_RECORD_COUNT = 3;

/**
 * LLM の出力に許す最大トークン数。出来事は detail を含めて最大5件書かせるため、
 * 既定値（invokeModelJson の2000）では足りないおそれがある。
 */
export const MAX_OUTPUT_TOKENS = 4000;

const USER_MESSAGE = "不在期間中の出来事と行動を、指定のJSON形式で書いてください。";

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runAbsenceSimulator(
  req: AbsenceSimulatorRequest
): Promise<AbsenceSimulatorResult> {
  console.log("[absenceSimulator] start");

  const { characterId, world, character, lifestyle } = req;
  // サーバーの現在時刻。GSI のソートキー、新しい話題の openedAt、14日の自動クローズの
  // 基準になる。
  const createdAt = new Date().toISOString();

  const skeleton = buildAbsenceSkeleton({
    lifestyle,
    timeZone: world.timezone,
    lastLoginAt: new Date(req.lastLoginAt),
    now: new Date(req.now),
  });

  const [latest, recentRecords, memories] = await Promise.all([
    getLatestAbsenceRecord(characterId),
    getRecentAbsenceRecords(characterId, RECENT_ABSENCE_RECORD_COUNT),
    getRelevantMemories(characterId),
  ]);

  const previousThreads = latest?.threads ?? [];
  const openThreads = selectOpenThreadsForPrompt(previousThreads, createdAt);
  const recentEventSummaries = recentRecords.flatMap((r) => r.events.map((e) => e.summary));

  const layers = buildAbsenceSimulatorPromptLayers({
    world,
    character,
    skeleton,
    openThreads,
    recentEventSummaries,
    memories,
  });

  let modelOutput: AbsenceSimulatorModelOutput;
  try {
    modelOutput = await invokeModelJson<AbsenceSimulatorModelOutput>(
      layers,
      USER_MESSAGE,
      EMPTY_MODEL_OUTPUT,
      MAX_OUTPUT_TOKENS
    );
  } catch (e) {
    // Bedrock の例外（throttling など）が起きても、記録の保存とログインの流れは止めない（D-020）。
    console.warn(
      "[absenceSimulator] model invocation failed, using fallback:",
      (e as Error).message
    );
    modelOutput = EMPTY_MODEL_OUTPUT;
  }

  const record = buildAbsenceRecord({
    eventId: randomUUID(),
    characterId,
    createdAt,
    skeleton,
    previousThreads,
    modelOutput,
    createThreadId: () => randomUUID(),
  });

  // DynamoDB の例外はここでは捕まえず、ハンドラーの 500 に任せる。
  await saveAbsenceRecord(record);

  const openThreadCount = record.threads.filter((t) => t.status === "open").length;
  console.log(
    `[absenceSimulator] generated ${record.events.length} events, ${record.actions.length} actions, ${openThreadCount} open threads`
  );

  return {
    startDatetime: record.startDatetime,
    endDatetime: record.endDatetime,
    events: record.events.map(({ kind, summary, detail }) => ({ kind, summary, detail })),
    actions: record.actions,
  };
}
