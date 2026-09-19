// -------------------------------------------------------
// dialogueGenerator
// 感情・関係値、重要記憶、最近の会話、最新の不在期間の記録を踏まえて
// キャラクターのセリフを生成する（POST /dialogue-generator）。
//
// D-022: リクエストの events/actions は廃止し、不在期間の出来事・行動は
// 会話のたびに DynamoDB から最新の記録（getLatestAbsenceRecord）を読んで使う。
// D-032: mood/perception もリクエストでは受け取らず、常に getCharacterState で
// DynamoDB から読む（値はフロントが中継していたものと同じで、中継を無くしただけ）。
// システムプロンプトは [固定部, セッション部, 可変部] の3層に分け、
// 層の配列のまま invokeModel に渡す（プロンプトキャッシュ、D-017）。
// -------------------------------------------------------

import { invokeModel } from "../lib/bedrock.js";
import {
  getCharacterState,
  getRelevantMemories,
  getRecentLogs,
  getLatestAbsenceRecord,
  saveConversationLog,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../lib/dynamo.js";
import { buildDialogueGeneratorPromptLayers } from "./prompt.js";
import type { DialogueGeneratorRequest } from "../types.js";

const RECENT_LOG_LIMIT = 10;

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

  // 感情・関係値・直近会話・重要記憶・最新の不在期間の記録を並行して取得
  const [state, recentLogs, memories, latestAbsenceRecord] = await Promise.all([
    getCharacterState(characterId),
    getRecentLogs(characterId, RECENT_LOG_LIMIT),
    getRelevantMemories(characterId, {
      queryText: req.message !== "" ? req.message : undefined,
    }),
    getLatestAbsenceRecord(characterId),
  ]);
  const mood = state.mood ?? { ...DEFAULT_MOOD };
  const perception = state.perception ?? { ...DEFAULT_PERCEPTION };

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
