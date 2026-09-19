// -------------------------------------------------------
// 感情・関係値の状態の読み込み（D-040）
//
// emotionUpdater・dialogueGenerator・debugCharacterState の3つが使う共通の手順:
// 状態レコードを読む → 無ければ初期状態（古い形のレコードなら関係値だけ引き継ぐ）→
// now まで時間を進める（終わったセッションの確定を含む）。
//
// 計算は lib/affect/ の純粋な関数で、ここは DynamoDB の読み取りとの組み合わせだけを行う。
// 保存はしない。状態レコードに書くのは emotionUpdater とデバッグ用のエンドポイントだけ
// （dialogueGenerator は進めた結果を読むだけ。書き手を1つにして上書きの衝突を避ける）。
// -------------------------------------------------------

import { getRelationshipRecord, getStoredAffectState } from "./dynamo.js";
import { projectAffectState, resolveStoredAffectState } from "./affect/affectProjection.js";
import { resolveAffectProfile } from "./affect/personality.js";
import type { AffectProfile } from "./affect/affectConfig.js";
import type { CharacterAffectState, CharacterDefinition, Lifestyle, RelationshipStage, World } from "../types.js";

export interface LoadProjectedAffectStateArgs {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  now: Date;
  /**
   * 今の関係の段階。呼び出し側がすでに関係の記録を読んでいる（dialogueGenerator）ときに渡す。
   * 省略すると、関係の記録を読んで決める（記録が無ければ最初の段階）。
   */
  stageKey?: string;
}

export interface ProjectedAffectState {
  state: CharacterAffectState; // now まで進めた状態（保存はしていない）
  profile: AffectProfile;
  stage: RelationshipStage; // 今の段階（stageKey が段階の一覧に無ければ最初の段階）
  stageIndex: number;
  isNewState: boolean; // 状態レコードが無かった・古い形だった（初期状態から始めた）
}

/** 状態レコードを読み、now まで進めた状態を返す（保存はしない） */
export async function loadProjectedAffectState(args: LoadProjectedAffectStateArgs): Promise<ProjectedAffectState> {
  const { characterId, world, character, lifestyle, now } = args;
  const stages = character.relationshipStages;

  const [stored, stageKey] = await Promise.all([
    getStoredAffectState(characterId),
    args.stageKey !== undefined
      ? Promise.resolve(args.stageKey)
      : getRelationshipRecord(characterId).then((record) => record?.stageKey ?? stages[0].key),
  ]);

  const profile = resolveAffectProfile(character);
  const baseState = resolveStoredAffectState(stored, character, profile, now);
  const state = projectAffectState(baseState, now, {
    profile,
    lifestyle,
    timeZone: world.timezone,
    stages,
    stageKey,
  });

  const foundIndex = stages.findIndex((stage) => stage.key === stageKey);
  const stageIndex = foundIndex >= 0 ? foundIndex : 0;

  return { state, profile, stage: stages[stageIndex], stageIndex, isNewState: stored.state === null };
}
