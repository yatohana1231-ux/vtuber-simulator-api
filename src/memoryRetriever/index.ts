// -------------------------------------------------------
// memoryRetriever
// process=1 は最新の不在期間の記録（DynamoDB から読む。D-022）、
// process=2 は会話ログを Bedrock で重要度判定し、character_memory テーブルに保存する。
//
// プロセス2では5往復ごとに判定。
// 5往復未満の場合はスキップ。
// 会話ログの memoryRetrieverJudgedFlag がすべて0の場合のみ判定実行。
// -------------------------------------------------------

import { randomUUID } from "crypto";

import { buildMemoryRetrieverPromptLayers } from "./prompt.js";
import { invokeModelJson } from "../lib/bedrock.js";
import { formatAbsenceRecordAsInputText } from "../lib/absenceRecordText.js";
import {
  getRelevantMemories,
  getLatestAbsenceRecord,
  getLogsForMemoryJudge,
  markLogsAsJudged,
  saveMemory,
} from "../lib/dynamo.js";
import type {
  CharacterDefinition,
  EmotionValence,
  MemoryCandidate,
  MemoryRetrieverRequest,
  MemoryRetrieverResult,
  World,
} from "../types.js";

const JUDGE_TURNS = 5; // プロセス2で判定する往復数

const EMOTION_VALENCES: readonly EmotionValence[] = ["positive", "negative", "neutral"];

/** モデル出力の emotionValence が3値のどれかならそのまま、それ以外（省略・不正値）は undefined にする */
function normalizeEmotionValence(value: unknown): EmotionValence | undefined {
  return EMOTION_VALENCES.includes(value as EmotionValence) ? (value as EmotionValence) : undefined;
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runMemoryRetriever(
  req: MemoryRetrieverRequest
): Promise<void> {
  console.log(`[memoryRetriever] start process=${req.process}`);

  const { characterId, world, character } = req;

  if (req.process === 1) {
    await judgeProcess1(characterId, world, character);
  } else {
    await judgeProcess2(characterId, world, character);
  }
}

// -------------------------------------------------------
// プロセス1: 最新の不在期間の記録を判定（D-022）
// -------------------------------------------------------

async function judgeProcess1(
  characterId: string,
  world: World,
  character: CharacterDefinition
): Promise<void> {
  const record = await getLatestAbsenceRecord(characterId);
  if (!record) {
    console.log(`[memoryRetriever] no absence record for characterId=${characterId}, skip`);
    return;
  }

  const inputText = formatAbsenceRecordAsInputText(record, world.timezone);

  await runJudgement(characterId, world, character, inputText);
}

// -------------------------------------------------------
// プロセス2: 直近5往復の会話ログを判定
// -------------------------------------------------------

async function judgeProcess2(
  characterId: string,
  world: World,
  character: CharacterDefinition
): Promise<void> {
  const logs = await getLogsForMemoryJudge(characterId, JUDGE_TURNS);

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
      const speaker = l.role === "user" ? "プレイヤー" : character.name;
      return `${speaker}: ${l.content}`;
    })
    .join("\n");

  const inputText = `【直近の会話（${JUDGE_TURNS}往復）】\n${conversationText}`;

  await runJudgement(characterId, world, character, inputText);

  // 判定済みフラグを付ける
  const indexes = logs.map((l) => l.index);
  await markLogsAsJudged(characterId, indexes);
}

// -------------------------------------------------------
// 共通: Bedrock で判定して重要記憶を保存
// -------------------------------------------------------

async function runJudgement(
  characterId: string,
  world: World,
  character: CharacterDefinition,
  inputText: string
): Promise<void> {
  // 既存の重要記憶を取得（重複保存を避けたい用途のため、他の呼び出し元より広めに取得する）
  const existingMemories = await getRelevantMemories(characterId, {
    queryText: inputText,
    topK: 20,
    minImportance: 10,
  });
  const existingMemoriesText =
    existingMemories.length > 0
      ? existingMemories
          .map(
            (m) =>
              `[index:${m.index}] ${m.eventSummary ?? ""}${m.characterInterpretation ? "（" + m.characterInterpretation + "）" : ""}`
          )
          .join("\n")
      : "（なし）";

  const systemPrompt = buildMemoryRetrieverPromptLayers({
    world,
    character,
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
    toSave.map((c) => {
      const emotionValence = normalizeEmotionValence(c.emotionValence);
      return saveMemory({
        memory_id: characterId,
        index: new Date().toISOString() + "_" + randomUUID().slice(0, 8),
        eventSummary: c.eventSummary,
        characterInterpretation: c.characterInterpretation,
        tags: c.tags,
        importance: c.importance,
        memoryType: c.memoryType,
        relationshipChanges: c.relationshipChanges,
        emotion: c.emotion,
        ...(emotionValence ? { emotionValence } : {}),
        reason: c.reason,
        updatedAt: new Date().toISOString(),
      });
    })
  );

  console.log(`[memoryRetriever] saved ${toSave.length} memories`);
}
