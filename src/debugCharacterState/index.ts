// -------------------------------------------------------
// debugCharacterState
// デバッグ専用: mood/perception の値を直接指定して DynamoDB の状態レコード
// （キャラクター記憶テーブルの index = "state"）を書き換える（POST /debug-character-state）。
// Bedrock は呼ばない。stg などステージを限定して有効化する
// （.notes/done/debug-character-state-roadmap.md）。
// -------------------------------------------------------

import { getCharacterState, saveCharacterState } from "../lib/dynamo.js";
import type { DebugCharacterStateRequest, DebugCharacterStateResponse } from "../types.js";

/**
 * mood/perception のどちらかが指定されていれば、今の値（`getCharacterState`）に
 * 上書きして保存する。片方だけの指定なら、もう片方は今の値のまま保存する
 * （ロードマップ「方針3」）。どちらも指定が無ければ保存せず、今の値をそのまま返す
 * （状態タブの読み取りに使う）。
 */
export async function runDebugCharacterState(
  req: DebugCharacterStateRequest
): Promise<DebugCharacterStateResponse> {
  const { characterId, character, mood, perception } = req;

  const current = await getCharacterState(characterId, character.initialPerception);

  if (mood === undefined && perception === undefined) {
    console.log(`[debugCharacterState] no mood/perception specified, read-only characterId=${characterId}`);
    return current;
  }

  const updatedMood = mood ?? current.mood;
  const updatedPerception = perception ?? current.perception;

  await saveCharacterState(characterId, updatedMood, updatedPerception);
  console.log(`[debugCharacterState] saved characterId=${characterId}`);

  return { mood: updatedMood, perception: updatedPerception };
}
