// -------------------------------------------------------
// emotionUpdater（D-040）
//
// LLM には出来事の評価（分類）だけをさせ、感情・気分・欲求・関係値の数値は
// サーバーの純粋な関数（lib/affect/）で計算する。関係値は発言ごとには動かさず、
// セッションの途中経過（pendingSession）にため、セッションが終わったときに
// projectAffectState（lib/affectStateStore.ts 経由）の中で1回だけ反映する。
//
// process=1 は最新の不在期間の記録（DynamoDB から読む。D-022）、
// process=2 はプレイヤー発言を入力にする。
// -------------------------------------------------------

import { buildEmotionUpdaterPromptLayers } from "./prompt.js";
import { invokeModelJson } from "../lib/bedrock.js";
import { formatAbsenceRecordAsInputText } from "../lib/absenceRecordText.js";
import { loadProjectedAffectState } from "../lib/affectStateStore.js";
import { getLatestAbsenceRecord, getRecentLogs, saveCharacterAffectState } from "../lib/dynamo.js";
import { appraisalsToEmotionImpulses, parseEmotionUpdaterModelOutput } from "../lib/affect/appraisal.js";
import { applyEmotionImpulses, getActiveEmotions } from "../lib/affect/emotionDynamics.js";
import { applyPullPush, describeMood } from "../lib/affect/moodDynamics.js";
import { relieveLonelinessByMessage } from "../lib/affect/needs.js";
import { computeMessageContribution } from "../lib/affect/perceptionDynamics.js";
import { addMessageToSession } from "../lib/affect/sessionAccumulator.js";
import { formatAffectForPrompt } from "../lib/affect/affectText.js";
import type { CharacterAffectState, ConversationLogItem, EmotionUpdaterRequest, EmotionUpdaterResponse } from "../types.js";

// process=2 で直近の会話を読む件数（/dialogue-generator が先に呼ばれているため、
// 末尾は「今回のプレイヤーの発言」と「それへのキャラクターの返事」になっている）
const RECENT_LOG_LIMIT = 6;

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runEmotionUpdater(req: EmotionUpdaterRequest): Promise<EmotionUpdaterResponse> {
  console.log(`[emotionUpdater] start process=${req.process} characterId=${req.characterId}`);

  const { characterId, world, character, lifestyle } = req;
  const now = new Date(req.now);

  const { state: projectedState, profile, stage, stageIndex } = await loadProjectedAffectState({
    characterId,
    world,
    character,
    lifestyle,
    now,
  });

  let inputText: string;
  let recentConversationText = "";

  if (req.process === 1) {
    // process=1: 最新の不在期間の記録を読む（D-022）。記録が無ければ LLM を呼ばず、
    // 時間の変化とセッションの確定を残すため、進めた状態だけ保存して返す。
    const record = await getLatestAbsenceRecord(characterId);
    if (!record) {
      console.log(`[emotionUpdater] no absence record for characterId=${characterId}, skip LLM`);
      await saveCharacterAffectState(characterId, projectedState);
      logUpdatedState(projectedState);
      return responseFromState(projectedState);
    }
    inputText = formatAbsenceRecordAsInputText(record, world.timezone);
  } else {
    // process=2: プレイヤー発言がインプット。直近の会話のうち、今回の発言より前だけを
    // 【最近の会話】に入れる（/dialogue-generator がすでに今回のやり取りをログに残している）
    inputText = `【プレイヤーの発言】\n${req.playerMessage}`;
    const recentLogs = await getRecentLogs(characterId, RECENT_LOG_LIMIT);
    recentConversationText = formatPriorConversation(recentLogs, req.playerMessage, character.name);
  }

  const systemPrompt = buildEmotionUpdaterPromptLayers({
    world,
    character,
    process: req.process,
    affectText: formatAffectForPrompt(projectedState),
    stageDescription: stage.description,
    recentConversationText,
    inputText,
  });

  const fallback: unknown = { appraisals: [] };
  const raw = await invokeModelJson<unknown>(systemPrompt, "出来事を評価してください。", fallback);
  const { appraisals, interaction, warnings } = parseEmotionUpdaterModelOutput(raw, profile.goals, req.process);
  for (const warning of warnings) {
    console.warn(`[emotionUpdater] ${warning}`);
  }

  const impulses = appraisalsToEmotionImpulses(appraisals, profile);
  const emotions = applyEmotionImpulses(projectedState.emotions, impulses);
  const mood = applyPullPush(projectedState.mood, emotions);

  let needs = projectedState.needs;
  let pendingSession = projectedState.pendingSession;

  if (req.process === 2) {
    needs = { ...needs, loneliness: relieveLonelinessByMessage(needs.loneliness) };

    const contribution = computeMessageContribution({
      impulses,
      interaction,
      stageIndex,
      stageCount: character.relationshipStages.length,
    });
    pendingSession = addMessageToSession(pendingSession, contribution, now);
  }

  const updatedState: CharacterAffectState = {
    ...projectedState,
    emotions,
    mood,
    needs,
    pendingSession,
  };

  await saveCharacterAffectState(characterId, updatedState);
  logAppraisalSummary(appraisals, impulses);
  logUpdatedState(updatedState);

  return responseFromState(updatedState);
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

function responseFromState(state: CharacterAffectState): EmotionUpdaterResponse {
  return {
    emotions: state.emotions,
    mood: state.mood,
    needs: state.needs,
    perception: state.perception,
  };
}

/**
 * 直近の会話ログ（古い順）から、今回のプレイヤーの発言より前の会話だけを
 * 「プレイヤー: …」「{キャラクター名}: …」の行にして返す。
 * 末尾から見て、今回の発言と同じ content の user ログを探し、それ以降（そのログを含む）を除く。
 * 見つからなければ全部を入れる。
 */
function formatPriorConversation(
  logs: ConversationLogItem[],
  playerMessage: string,
  characterName: string
): string {
  let cutIndex = logs.length;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].role === "user" && logs[i].content === playerMessage) {
      cutIndex = i;
      break;
    }
  }

  const prior = logs.slice(0, cutIndex);
  return prior.map((log) => `${log.role === "user" ? "プレイヤー" : characterName}: ${log.content}`).join("\n");
}

/** 評価の要約（summary・情動・強さ）をログに出す。characterId 以外の個人情報・機密は出さない */
function logAppraisalSummary(
  appraisals: { summary: string }[],
  impulses: { emotion: string; intensity: number }[]
): void {
  const appraisalSummaries = appraisals.map((a) => a.summary).filter((s) => s.length > 0);
  const impulseSummaries = impulses.map((i) => `${i.emotion}+${Math.round(i.intensity)}`);
  console.log(
    `[emotionUpdater] appraisals=${JSON.stringify(appraisalSummaries)} impulses=${JSON.stringify(impulseSummaries)}`
  );
}

/** 更新後の気分・活動中の情動をログに出す */
function logUpdatedState(state: CharacterAffectState): void {
  const { octant, strength } = describeMood(state.mood);
  const active = getActiveEmotions(state.emotions).map((e) => `${e.emotion}:${Math.round(e.intensity)}`);
  console.log(`[emotionUpdater] updated mood=${octant}(${strength}) activeEmotions=${JSON.stringify(active)}`);
}
