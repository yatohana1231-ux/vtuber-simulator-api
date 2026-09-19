// -------------------------------------------------------
// dialogueGenerator
// 感情・関係値、重要記憶、最近の会話、最新の不在期間の記録、関係の段階・履歴を
// 踏まえてキャラクターのセリフを生成する（POST /dialogue-generator）。
//
// D-022: リクエストの events/actions は廃止し、不在期間の出来事・行動は
// 会話のたびに DynamoDB から最新の記録（getLatestAbsenceRecord）を読んで使う。
// D-032: mood/perception もリクエストでは受け取らず、常に getCharacterState で
// DynamoDB から読む（値はフロントが中継していたものと同じで、中継を無くしただけ）。
// D-033: 関係の記録（RelationshipRecord）を読み、advanceRelationship で
// 「下がる → 履歴の更新 → 戻る → 上がる」の順に進めてから保存する（モデルを呼ぶ前）。
// 段階が変わった節目（RelationshipMilestone）は、プレイヤーには伝えず、重要記憶
// （memoryType: RELATIONSHIP_MILESTONE_MEMORY_TYPE）と CloudWatch のログにだけ残す。
// システムプロンプトは [固定部, セッション部, 可変部] の3層に分け、
// 層の配列のまま invokeModel に渡す（プロンプトキャッシュ、D-017）。
// -------------------------------------------------------

import { randomUUID } from "crypto";

import { invokeModel } from "../lib/bedrock.js";
import {
  getCharacterState,
  getRelevantMemories,
  getRecentLogs,
  getLatestAbsenceRecord,
  getRelationshipRecord,
  saveConversationLog,
  saveRelationshipRecord,
  saveMemory,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
  RELATIONSHIP_MILESTONE_MEMORY_TYPE,
} from "../lib/dynamo.js";
import { advanceRelationship } from "../lib/relationship.js";
import { formatRelationshipHistoryForPrompt } from "../lib/relationshipText.js";
import { buildDialogueGeneratorPromptLayers } from "./prompt.js";
import type {
  CharacterMemoryItem,
  DialogueGeneratorRequest,
  RelationshipMilestone,
  RelationshipStage,
} from "../types.js";

const RECENT_LOG_LIMIT = 10;

// 節目の重要記憶の重要度。セリフの生成にも重要記憶の判定にも使わない記録専用の
// 項目だが、CharacterMemoryItem の項目として妥当な値を入れておく
const MILESTONE_MEMORY_IMPORTANCE = 70;

const MILESTONE_VERB: Record<RelationshipMilestone["kind"], string> = {
  promoted: "上がった",
  demoted: "下がった",
  recovered: "戻った",
};

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runDialogueGenerator(
  req: DialogueGeneratorRequest
): Promise<string> {
  console.log("[dialogueGenerator] start");

  const { characterId, world, character } = req;
  const now = new Date(req.now);
  const longTimeFlag = req.longTimeFlag ?? 0;

  // プレイヤーメッセージ（空欄の場合は代替テキスト）
  const playerMessage =
    req.message === "" ? "（プレイヤーが来た）" : req.message;

  // プレイヤー発言を会話ログに保存
  await saveConversationLog(characterId, "user", playerMessage, 0);

  // 感情・関係値・直近会話・重要記憶・最新の不在期間の記録・関係の記録を並行して取得
  const [state, recentLogs, memories, latestAbsenceRecord, relationshipRecord] = await Promise.all([
    getCharacterState(characterId, character.initialPerception),
    getRecentLogs(characterId, RECENT_LOG_LIMIT),
    getRelevantMemories(characterId, {
      queryText: req.message !== "" ? req.message : undefined,
    }),
    getLatestAbsenceRecord(characterId),
    getRelationshipRecord(characterId),
  ]);
  const mood = state.mood ?? { ...DEFAULT_MOOD };
  const perception = state.perception ?? { ...DEFAULT_PERCEPTION };

  // 関係の記録を「下がる → 履歴の更新 → 戻る → 上がる」の順に進める（D-033）
  const { record: advancedRelationship, milestones } = advanceRelationship({
    record: relationshipRecord,
    stages: character.relationshipStages,
    perception,
    now,
    timeZone: world.timezone,
    isPlayerMessage: req.message !== "",
  });

  // 進めた関係の記録と、節目があれば重要記憶を、モデルを呼ぶ前に保存する
  await Promise.all([
    saveRelationshipRecord(characterId, advancedRelationship),
    ...milestones.map((milestone) => saveMilestoneMemory(characterId, milestone, character.relationshipStages)),
  ]);

  const currentStage = findStage(character.relationshipStages, advancedRelationship.stageKey);
  const relationshipHistoryText = formatRelationshipHistoryForPrompt(advancedRelationship, now, world.timezone);

  // 直近会話の末尾は今保存した user ログなので除く
  const historyLogs = recentLogs.slice(0, -1);

  // システムプロンプトを層ごとの配列 [固定部, セッション部, 可変部] で組み立てる
  const systemPromptLayers = buildDialogueGeneratorPromptLayers({
    world,
    character,
    mood,
    perception,
    memories,
    historyLogs: historyLogs.map((l) => ({
      role: l.role,
      content: l.content,
      index: l.index,
    })),
    latestAbsenceRecord,
    currentStage,
    relationshipHistoryText,
    now,
    longTimeFlag,
  });

  console.log("[dialogueGenerator] systemPrompt built");

  // Bedrock を呼び出してセリフを取得
  const reply = await invokeModel(systemPromptLayers, playerMessage, 500);

  console.log("[dialogueGenerator] reply:", reply);

  // キャラクターのセリフを会話ログに保存
  await saveConversationLog(characterId, "assistant", reply, 0);

  return reply;
}

// -------------------------------------------------------
// 関係の段階・節目のヘルパー（すべて非export）
// -------------------------------------------------------

/** stages の中から stageKey に一致する段階を探す。見つからなければ先頭の段階を返す */
function findStage(stages: RelationshipStage[], stageKey: string): RelationshipStage {
  return stages.find((stage) => stage.key === stageKey) ?? stages[0];
}

/**
 * 節目（段階の変化）を重要記憶として保存する。プレイヤーには伝えないための
 * 記録専用の項目（memoryType: RELATIONSHIP_MILESTONE_MEMORY_TYPE）。
 * あわせて CloudWatch のログにも出す。
 */
async function saveMilestoneMemory(
  characterId: string,
  milestone: RelationshipMilestone,
  stages: RelationshipStage[]
): Promise<void> {
  const fromLabel = findStage(stages, milestone.fromStageKey).label;
  const toLabel = findStage(stages, milestone.toStageKey).label;
  const eventSummary = `プレイヤーとの関係が「${fromLabel}」から「${toLabel}」に${MILESTONE_VERB[milestone.kind]}`;

  console.log("[dialogueGenerator] relationship milestone", {
    characterId,
    kind: milestone.kind,
    fromStageKey: milestone.fromStageKey,
    toStageKey: milestone.toStageKey,
    at: milestone.at,
  });

  const item: CharacterMemoryItem = {
    memory_id: characterId,
    index: `${milestone.at}_${randomUUID().slice(0, 8)}`,
    eventSummary,
    memoryType: RELATIONSHIP_MILESTONE_MEMORY_TYPE,
    importance: MILESTONE_MEMORY_IMPORTANCE,
    tags: ["relationship_milestone", milestone.kind],
    updatedAt: milestone.at,
  };
  await saveMemory(item);
}
