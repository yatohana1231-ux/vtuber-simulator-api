// -------------------------------------------------------
// dialogueGenerator
// 感情・関係値、重要記憶、最近の会話、最新の不在期間の記録、関係の段階・履歴を
// 踏まえてキャラクターのセリフを生成する（POST /dialogue-generator）。
//
// D-022: リクエストの events/actions は廃止し、不在期間の出来事・行動は
// 会話のたびに DynamoDB から最新の記録（getLatestAbsenceRecord）を読んで使う。
// D-032: mood/perception もリクエストでは受け取らず、常に DynamoDB から読む
// （値はフロントが中継していたものと同じで、中継を無くしただけ）。
// D-040: 感情・関係値の状態は loadProjectedAffectState（affectStateStore.ts）で
// now まで進めた値を読むだけで、dialogueGenerator は状態レコードに書かない
// （書き手は emotionUpdater だけ。上書きの衝突を避けるため）。
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
  getRelevantMemories,
  getRecentLogs,
  getLatestAbsenceRecord,
  getRelationshipRecord,
  saveConversationLog,
  saveRelationshipRecord,
  saveMemory,
  RELATIONSHIP_MILESTONE_MEMORY_TYPE,
} from "../lib/dynamo.js";
import { loadProjectedAffectState } from "../lib/affectStateStore.js";
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

  const { characterId, world, character, lifestyle } = req;
  const now = new Date(req.now);
  const isPlayerMessage = req.message !== "";

  // プレイヤーメッセージ（空欄の場合は代替テキスト）
  const playerMessage =
    req.message === "" ? "（プレイヤーが来た）" : req.message;

  // プレイヤー発言を会話ログに保存
  await saveConversationLog(characterId, "user", playerMessage, 0);

  // 直近会話・最新の不在期間の記録・関係の記録を並行して取得
  // （感情・関係値の状態は、段階の判定に使う「進める前の段階」が関係の記録から
  // 決まったあとで読む。下の loadProjectedAffectState 参照。重要記憶は、気分一致の
  // 記憶のために今の気分が要るので、状態のあとで読む。D-040）
  const [recentLogs, latestAbsenceRecord, relationshipRecord] = await Promise.all([
    getRecentLogs(characterId, RECENT_LOG_LIMIT),
    getLatestAbsenceRecord(characterId),
    getRelationshipRecord(characterId),
  ]);

  // 進める前の段階（関係の記録の stageKey。記録が無ければ最初の段階）で、
  // 感情・関係値の状態を now まで進める（保存はしない。書き手は emotionUpdater だけ）
  const preAdvanceStageKey = relationshipRecord?.stageKey ?? character.relationshipStages[0].key;
  const { state: affectState } = await loadProjectedAffectState({
    characterId,
    world,
    character,
    lifestyle,
    now,
    stageKey: preAdvanceStageKey,
  });

  // 関係の記録を「下がる → 履歴の更新 → 戻る → 上がる」の順に進める（D-033）。
  // 判定には、進めたあとの関係値（affectState.perception）を使う
  const { record: advancedRelationship, milestones } = advanceRelationship({
    record: relationshipRecord,
    stages: character.relationshipStages,
    perception: affectState.perception,
    now,
    timeZone: world.timezone,
    isPlayerMessage,
  });

  // 進めた関係の記録と、節目があれば重要記憶を、モデルを呼ぶ前に保存する。
  // あわせて重要記憶を読む。今の気分の快・不快（moodPleasure）を渡し、気分と同じ向きの
  // 感情の記憶を思い出しやすくする（気分一致の記憶。D-040。節目の記憶はもともと取得の対象外）
  const [memories] = await Promise.all([
    getRelevantMemories(characterId, {
      queryText: req.message !== "" ? req.message : undefined,
      moodPleasure: affectState.mood.pleasure,
    }),
    saveRelationshipRecord(characterId, advancedRelationship),
    ...milestones.map((milestone) => saveMilestoneMemory(characterId, milestone, character.relationshipStages)),
  ]);

  const currentStage = findStage(character.relationshipStages, advancedRelationship.stageKey);
  const relationshipHistoryText = formatRelationshipHistoryForPrompt(advancedRelationship, now, world.timezone);

  // 直近会話の末尾は今保存した user ログなので除く
  const historyLogs = recentLogs.slice(0, -1);

  // システムプロンプトを層ごとの配列 [固定部, セッション部, 可変部] で組み立てる。
  // プロンプトに使う感情・関係値は、段階の判定に使った affectState をそのまま使う
  // （段階が変わった場合でも作り直さない。下端の作り直しは次に emotionUpdater が
  // 保存するときに行われるので、プロンプト用の値としてはこれで十分）
  const systemPromptLayers = buildDialogueGeneratorPromptLayers({
    world,
    character,
    affectState,
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
    isPlayerMessage,
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
