// -------------------------------------------------------
// debugCharacterState
// デバッグ専用: 情動（emotions）・気分（mood）・欲求（needs）・関係値（perception）
// （CharacterAffectState、D-040）を読み取り・書き換える（POST /debug-character-state）。
// Bedrock は呼ばない。stg などステージを限定して有効化する
// （.notes/done/debug-character-state-roadmap.md、D-038）。
// -------------------------------------------------------

import { loadProjectedAffectState } from "../lib/affectStateStore.js";
import { saveCharacterAffectState } from "../lib/dynamo.js";
import type {
  CharacterAffectState,
  DebugCharacterStateRequest,
  DebugCharacterStateResponse,
  RelationshipStage,
} from "../types.js";

/**
 * 状態レコードを `now` まで進めたうえで、指定された見出し（`emotions`/`mood`/
 * `needs`/`perception`）だけを置き換えて保存する。
 *
 * - `needs` は `loneliness` だけを置き換える。`fatigue` は生活様式と時刻から
 *   毎回計算し直す値（`loadProjectedAffectState` → `computeFatigue`）なので、
 *   ここで置き換えると次に進めたときに上書きされて意味が無い。そのため
 *   `DebugCharacterStateRequest.needs` の型自体に `loneliness` しか持たせていない
 *   （ハンドラーの入力チェックも `fatigue` の指定は検証せず無視する）。
 * - `perception` を置き換えたときは `perceptionStageBase` を `null` にする。
 *   次に `loadProjectedAffectState`（`projectAffectState`）で進めるときに、
 *   置き換えた値を関係値の釣り鐘減衰の下端として作り直させるため。
 * - `pendingSession` はここでは触らない（`loadProjectedAffectState` が、進める過程で
 *   終わっていれば確定・`null` にしている）。
 * - どの見出しも指定が無ければ、保存せずに `now` まで進めた今の値をそのまま返す
 *   （デバッグパネルの「状態」タブの読み取りに使う）。
 */
export async function runDebugCharacterState(
  req: DebugCharacterStateRequest
): Promise<DebugCharacterStateResponse> {
  const { characterId, world, character, lifestyle, emotions, mood, needs, perception } = req;
  const now = new Date(req.now);

  const { state: projected, stage } = await loadProjectedAffectState({
    characterId,
    world,
    character,
    lifestyle,
    now,
  });

  const hasChange =
    emotions !== undefined || mood !== undefined || needs !== undefined || perception !== undefined;

  if (!hasChange) {
    console.log(`[debugCharacterState] no change specified, read-only characterId=${characterId}`);
    return toResponse(projected, stage);
  }

  const updated: CharacterAffectState = {
    ...projected,
    ...(emotions !== undefined ? { emotions } : {}),
    ...(mood !== undefined ? { mood } : {}),
    ...(needs !== undefined ? { needs: { ...projected.needs, loneliness: needs.loneliness } } : {}),
    ...(perception !== undefined ? { perception, perceptionStageBase: null } : {}),
  };

  await saveCharacterAffectState(characterId, updated);
  console.log(`[debugCharacterState] saved characterId=${characterId}`);

  return toResponse(updated, stage);
}

function toResponse(state: CharacterAffectState, stage: RelationshipStage): DebugCharacterStateResponse {
  return {
    emotions: state.emotions,
    mood: state.mood,
    needs: state.needs,
    perception: state.perception,
    pendingSession: state.pendingSession,
    stage: { key: stage.key, label: stage.label, maxPerception: stage.maxPerception ?? {} },
    affectUpdatedAt: state.affectUpdatedAt,
  };
}
