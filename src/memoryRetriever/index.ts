// -------------------------------------------------------
// memoryRetriever
// イベント・アクション（プロセス1）または会話ログ（プロセス2）を
// Bedrock で重要度判定し、character_memory テーブルに保存する。
//
// プロセス2では5往復ごとに判定。
// 5往復未満の場合はスキップ。
// 会話ログの memoryRetrieverJudgedFlag がすべて0の場合のみ判定実行。
// -------------------------------------------------------

import { randomUUID } from "crypto";
import Mustache from "mustache";

import PROMPT_TEMPLATE from "./prompts/memoryRetriever.mustache";
import { invokeModelJson } from "../lib/bedrock.js";
import {
  getMemories,
  getLogsForMemoryJudge,
  markLogsAsJudged,
  saveMemory,
} from "../lib/dynamo.js";
import type {
  Action,
  MemoryCandidate,
  MemoryRetrieverResult,
  NormalizedRequest,
} from "../types.js";

const JUDGE_TURNS = 5; // プロセス2で判定する往復数

// -------------------------------------------------------
// 引数型
// -------------------------------------------------------

interface MemoryRetrieverProcess1Args {
  req: NormalizedRequest;
  process: 1;
  events: string[];
  actions: Action[];
}

interface MemoryRetrieverProcess2Args {
  req: NormalizedRequest;
  process: 2;
}

type MemoryRetrieverArgs =
  | MemoryRetrieverProcess1Args
  | MemoryRetrieverProcess2Args;

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runMemoryRetriever(
  args: MemoryRetrieverArgs
): Promise<void> {
  console.log(`[memoryRetriever] start process=${args.process}`);

  const { req } = args;

  if (args.process === 1) {
    await judgeProcess1(req, args.events, args.actions);
  } else {
    await judgeProcess2(req);
  }
}

// -------------------------------------------------------
// プロセス1: イベント・アクションを判定
// -------------------------------------------------------

async function judgeProcess1(
  req: NormalizedRequest,
  events: string[],
  actions: Action[]
): Promise<void> {
  if (events.length === 0 && actions.length === 0) {
    console.log("[memoryRetriever] no events/actions to judge");
    return;
  }

  const eventsText =
    events.length > 0
      ? events.map((e, i) => `${i + 1}. ${e}`).join("\n")
      : "（なし）";

  const actionsText =
    actions.length > 0
      ? actions
          .map(
            (a) =>
              `・${a.startDatetime.slice(0, 16)} 〜 ${a.endDatetime.slice(0, 16)}: ${a.action}（${a.memo}）`
          )
          .join("\n")
      : "（なし）";

  const inputText = `【不在中の出来事】\n${eventsText}\n\n【不在中の行動】\n${actionsText}`;

  await runJudgement(req, inputText);
}

// -------------------------------------------------------
// プロセス2: 直近5往復の会話ログを判定
// -------------------------------------------------------

async function judgeProcess2(req: NormalizedRequest): Promise<void> {
  const logs = await getLogsForMemoryJudge(req.characterId, JUDGE_TURNS);

  // 5往復 = 10件未満の場合はスキップ
  if (logs.length < JUDGE_TURNS * 2) {
    console.log(
      `[memoryRetriever] only ${logs.length} logs, less than ${JUDGE_TURNS * 2} required. skip.`
    );
    return;
  }

  // 判定済みログが1件でも含まれていれば判定済みとしてスキップ
  const hasJudged = logs.some((l) => (l.memoryRetrieverJudgedFlag ?? 0) === 1);
  if (hasJudged) {
    console.log("[memoryRetriever] already judged, skip");
    return;
  }

  // 会話ログをテキスト化
  const conversationText = logs
    .map((l) => {
      const speaker = l.role === "user" ? "プレイヤー" : req.profile.name;
      return `${speaker}: ${l.content}`;
    })
    .join("\n");

  const inputText = `【直近の会話（${JUDGE_TURNS}往復）】\n${conversationText}`;

  await runJudgement(req, inputText);

  // 判定済みフラグを付ける
  const indexes = logs.map((l) => l.index);
  await markLogsAsJudged(req.characterId, indexes);
}

// -------------------------------------------------------
// 共通: Bedrock で判定して重要記憶を保存
// -------------------------------------------------------

async function runJudgement(
  req: NormalizedRequest,
  inputText: string
): Promise<void> {
  const { profile } = req;

  // 既存の重要記憶を取得
  const existingMemories = await getMemories(profile.name);
  const existingMemoriesText =
    existingMemories.length > 0
      ? existingMemories
          .map(
            (m) =>
              `[index:${m.index}] ${m.eventSummary ?? ""}${m.characterInterpretation ? "（" + m.characterInterpretation + "）" : ""}`
          )
          .join("\n")
      : "（なし）";

  const systemPrompt = Mustache.render(PROMPT_TEMPLATE, {
    name: profile.name,
    personality: profile.personality,
    existingMemoriesText,
    inputText,
  });

  const fallback: MemoryRetrieverResult = { candidates: [] };
  const result = await invokeModelJson<MemoryRetrieverResult>(
    systemPrompt,
    "重要度を判定して記憶候補を出力してください。",
    fallback
  );

  const candidates: MemoryCandidate[] = Array.isArray(result.candidates)
    ? result.candidates
    : [];

  console.log(`[memoryRetriever] ${candidates.length} candidates`);

  // shouldRemember=true かつ IGNORE 以外を保存
  const toSave = candidates.filter(
    (c) =>
      c.shouldRemember &&
      (c as MemoryCandidate & { memoryLabel?: string }).memoryLabel !== "IGNORE"
  );

  await Promise.all(
    toSave.map((c) =>
      saveMemory({
        memory_id: profile.name,
        index: new Date().toISOString() + "_" + randomUUID().slice(0, 8),
        eventSummary: c.eventSummary,
        characterInterpretation: c.characterInterpretation,
        tags: c.tags,
        importance: c.importance,
        memoryType: c.memoryType,
        relationshipChanges: c.relationshipChanges,
        emotion: c.emotion,
        reason: c.reason,
        updatedAt: new Date().toISOString(),
      })
    )
  );

  console.log(`[memoryRetriever] saved ${toSave.length} memories`);
}
