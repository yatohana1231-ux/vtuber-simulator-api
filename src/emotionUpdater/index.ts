// -------------------------------------------------------
// emotionUpdater
// process=1 は最新の不在期間の記録（DynamoDB から読む。D-022）、
// process=2 はプレイヤー発言をインプットとしてキャラクターの感情値・関係値を更新する。
// -------------------------------------------------------

import { buildEmotionUpdaterPromptLayers } from "./prompt.js";
import { invokeModelJson } from "../lib/bedrock.js";
import { formatAbsenceRecordForPrompt } from "../lib/absenceRecordText.js";
import {
  getCharacterState,
  getLatestAbsenceRecord,
  saveCharacterState,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../lib/dynamo.js";
import { clamp } from "../lib/utils.js";
import type {
  EmotionUpdaterRequest,
  EmotionUpdaterResponse,
  Mood,
  Perception,
} from "../types.js";

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runEmotionUpdater(
  req: EmotionUpdaterRequest
): Promise<EmotionUpdaterResponse> {
  console.log(`[emotionUpdater] start process=${req.process}`);

  const { characterId, world, character } = req;
  const { mood: currentMood, perception: currentPerception } =
    await getCharacterState(characterId);

  let inputText: string;

  if (req.process === 1) {
    // process=1: 最新の不在期間の記録を読む（D-022）。記録が無ければ LLM を呼ばず現在の状態を返す
    const record = await getLatestAbsenceRecord(characterId);
    if (!record) {
      console.log(`[emotionUpdater] no absence record for characterId=${characterId}, skip`);
      return { mood: currentMood, perception: currentPerception };
    }

    const { periodText, eventsText, actionsText } = formatAbsenceRecordForPrompt(record, world.timezone);
    inputText = `【不在中の出来事】（期間: ${periodText}）\n${eventsText}\n\n【不在中の行動】\n${actionsText}`;
  } else {
    // process=2: プレイヤー発言がインプット
    inputText = `【プレイヤーの発言】\n${req.playerMessage}`;
  }

  const systemPrompt = buildEmotionUpdaterPromptLayers({
    world,
    character,
    process: req.process,
    currentMood,
    currentPerception,
    inputText,
  });

  const fallback = { moodDelta: {}, perceptionDelta: {} };
  const delta = await invokeModelJson<{
    moodDelta: Partial<Record<keyof Mood, number>>;
    perceptionDelta: Partial<Record<keyof Perception, number>>;
  }>(systemPrompt, "感情値・関係値の差分を算出してください。", fallback);

  // 差分を適用して 1〜100 にクランプ
  const updatedMood = applyMoodDelta(currentMood, delta.moodDelta ?? {});
  const updatedPerception = applyPerceptionDelta(currentPerception, delta.perceptionDelta ?? {});

  // DynamoDB に保存
  await saveCharacterState(characterId, updatedMood, updatedPerception);

  console.log("[emotionUpdater] updated mood:", JSON.stringify(updatedMood));
  console.log("[emotionUpdater] updated perception:", JSON.stringify(updatedPerception));

  return { mood: updatedMood, perception: updatedPerception };
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

function applyMoodDelta(
  current: Mood,
  delta: Partial<Record<keyof Mood, number>>
): Mood {
  return {
    joy:        clamp((current.joy        ?? DEFAULT_MOOD.joy)        + (delta.joy        ?? 0)),
    anxiety:    clamp((current.anxiety    ?? DEFAULT_MOOD.anxiety)    + (delta.anxiety    ?? 0)),
    angry:      clamp((current.angry      ?? DEFAULT_MOOD.angry)      + (delta.angry      ?? 0)),
    fatigue:    clamp((current.fatigue    ?? DEFAULT_MOOD.fatigue)    + (delta.fatigue    ?? 0)),
    confidence: clamp((current.confidence ?? DEFAULT_MOOD.confidence) + (delta.confidence ?? 0)),
    loneliness: clamp((current.loneliness ?? DEFAULT_MOOD.loneliness) + (delta.loneliness ?? 0)),
  };
}

function applyPerceptionDelta(
  current: Perception,
  delta: Partial<Record<keyof Perception, number>>
): Perception {
  return {
    trust:      clamp((current.trust      ?? DEFAULT_PERCEPTION.trust)      + (delta.trust      ?? 0)),
    affection:  clamp((current.affection  ?? DEFAULT_PERCEPTION.affection)  + (delta.affection  ?? 0)),
    respect:    clamp((current.respect    ?? DEFAULT_PERCEPTION.respect)    + (delta.respect    ?? 0)),
    fear:       clamp((current.fear       ?? DEFAULT_PERCEPTION.fear)       + (delta.fear       ?? 0)),
    dependence: clamp((current.dependence ?? DEFAULT_PERCEPTION.dependence) + (delta.dependence ?? 0)),
    familiarity:clamp((current.familiarity ?? DEFAULT_PERCEPTION.familiarity) + (delta.familiarity ?? 0)),
  };
}
