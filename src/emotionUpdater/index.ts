// -------------------------------------------------------
// emotionUpdater
// process=1 は最新の不在期間の記録（DynamoDB から読む。D-022）、
// process=2 はプレイヤー発言をインプットとしてキャラクターの感情値・関係値を更新する。
// -------------------------------------------------------

import { buildEmotionUpdaterPromptLayers } from "./prompt.js";
import { invokeModelJson } from "../lib/bedrock.js";
import { formatAbsenceRecordAsInputText } from "../lib/absenceRecordText.js";
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
  const { mood: currentMood, perception: currentPerception } = await getCharacterState(
    characterId,
    character.initialPerception
  );

  let inputText: string;

  if (req.process === 1) {
    // process=1: 最新の不在期間の記録を読む（D-022）。記録が無ければ LLM を呼ばず現在の状態を返す
    const record = await getLatestAbsenceRecord(characterId);
    if (!record) {
      console.log(`[emotionUpdater] no absence record for characterId=${characterId}, skip`);
      return { mood: currentMood, perception: currentPerception };
    }

    inputText = formatAbsenceRecordAsInputText(record, world.timezone);
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

  // invokeModelJson は Bedrock の JSON 出力をそのまま返すだけで実行時の型チェックは行わないため、
  // ここでは unknown として受け取り、applyDelta 側で1項目ずつ検証する（F-019）。
  const fallback: unknown = { moodDelta: {}, perceptionDelta: {} };
  const delta = await invokeModelJson<unknown>(
    systemPrompt,
    "感情値・関係値の差分を算出してください。",
    fallback
  );

  // delta 自体、または moodDelta/perceptionDelta がプレーンなオブジェクトでない場合は
  // 差分なし（{}）として扱う（モデルの応答全体が null・配列・文字列などのケースに対応）
  const deltaObj = isPlainObject(delta) ? delta : {};

  // 差分を適用して 1〜100 にクランプ
  const updatedMood = applyDelta(currentMood, deltaObj.moodDelta, DEFAULT_MOOD, "moodDelta");
  const updatedPerception = applyDelta(
    currentPerception,
    deltaObj.perceptionDelta,
    DEFAULT_PERCEPTION,
    "perceptionDelta"
  );

  // DynamoDB に保存
  await saveCharacterState(characterId, updatedMood, updatedPerception);

  console.log("[emotionUpdater] updated mood:", JSON.stringify(updatedMood));
  console.log("[emotionUpdater] updated perception:", JSON.stringify(updatedPerception));

  return { mood: updatedMood, perception: updatedPerception };
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

/** value がプレーンなオブジェクト（null・配列・プリミティブではない）かどうか */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * moodDelta/perceptionDelta を current に適用して 1〜100 にクランプする（F-019）。
 * delta はモデルの応答をそのまま渡すため、実行時に型の保証が無い（unknown）。
 * - キーごとに `typeof v === "number" && Number.isFinite(v)` を満たす値だけを差分として採用する。
 *   数字の文字列（"5"）・null・NaN・Infinity・オブジェクト等はすべて 0（変化なし）として扱う。
 * - delta 自体がプレーンなオブジェクトでない場合（null・配列・文字列など）は {} と同じ扱いにする。
 * - キーが無い（undefined）はモデルが「変化なし」として省略した正常なケースなので警告しないが、
 *   それ以外の不正な値はログに残す（項目名と値）。
 * - キーの集合・順序は defaults（DEFAULT_MOOD/DEFAULT_PERCEPTION）から取り、Mood/Perception と揃える。
 * - current 側の `?? DEFAULT` のフォールバック（値が欠けているときの既定値）は従来どおり維持する。
 */
function applyDelta<T extends Mood | Perception>(
  current: T,
  delta: unknown,
  defaults: T,
  label: string
): T {
  const deltaObj = isPlainObject(delta) ? delta : {};
  const currentRecord = current as unknown as Record<string, number>;
  const defaultsRecord = defaults as unknown as Record<string, number>;
  const result: Record<string, number> = {};

  for (const key of Object.keys(defaultsRecord)) {
    const rawValue = deltaObj[key];
    let appliedDelta = 0;

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      appliedDelta = rawValue;
    } else if (rawValue !== undefined) {
      console.warn(`[emotionUpdater] ${label}.${key} が不正な値のため無視します（変化なしとして扱う）:`, rawValue);
    }

    result[key] = clamp((currentRecord[key] ?? defaultsRecord[key]) + appliedDelta);
  }

  return result as unknown as T;
}
