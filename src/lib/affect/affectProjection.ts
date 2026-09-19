// -------------------------------------------------------
// 保存してある状態を now まで進める処理と、初期状態（D-040）
//
// lib/affect/ の各計算（emotionDynamics・moodDynamics・needs・
// perceptionDynamics・sessionAccumulator）を組み合わせる。LLM も DB も
// 使わない純粋な関数（現在時刻は引数で受け取る。引数のオブジェクトは
// 書き換えず、新しいオブジェクトを返す）。
//
// 状態レコードに書くのは emotionUpdater（とデバッグ用のエンドポイント）だけ。
// dialogueGenerator は projectAffectState の結果を読むだけで保存しない
// （README「affectProjection.ts」節参照）。
// -------------------------------------------------------

import type { AffectConfig, AffectProfile } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG } from "./affectConfig.js";
import { createNeutralEmotions, decayEmotions } from "./emotionDynamics.js";
import { computeEffectiveHomeBase, decayMoodTowardHomeBase } from "./moodDynamics.js";
import { computeFatigue, projectLoneliness } from "./needs.js";
import { applyPerceptionDelta, decayFamiliarity, resolveStageBase } from "./perceptionDynamics.js";
import { isSessionEnded, settleSession } from "./sessionAccumulator.js";
import type { CharacterAffectState, CharacterDefinition, Lifestyle, Perception, RelationshipStage } from "../../types.js";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 状態が無いときの初期状態。情動は0、気分は（欲求でずらす前の）平常値、関係値は character.initialPerception */
export function createInitialAffectState(
  character: CharacterDefinition,
  profile: AffectProfile,
  now: Date,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): CharacterAffectState {
  return {
    emotions: createNeutralEmotions(),
    mood: { ...profile.moodHomeBase },
    needs: { fatigue: config.needs.fatigueBaseline, loneliness: 0 },
    perception: { ...character.initialPerception },
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: now.toISOString(),
  };
}

export interface ResolveStoredAffectStateInput {
  state: CharacterAffectState | null;
  legacyPerception: Perception | null;
}

/**
 * 保存してある状態レコードから CharacterAffectState を得る。
 * `state`（新しい形）があればそれをそのまま返す。無ければ初期状態を作り、
 * `legacyPerception`（古い形の状態レコードの perception）があれば
 * 関係値だけをそれに置き換える（関係値は引き継ぎ、感情は平常値から始める）。
 */
export function resolveStoredAffectState(
  stored: ResolveStoredAffectStateInput,
  character: CharacterDefinition,
  profile: AffectProfile,
  now: Date,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): CharacterAffectState {
  if (stored.state !== null) return stored.state;

  const initial = createInitialAffectState(character, profile, now, config);
  if (stored.legacyPerception === null) return initial;

  return { ...initial, perception: { ...stored.legacyPerception } };
}

export interface ProjectAffectStateContext {
  profile: AffectProfile;
  lifestyle: Lifestyle;
  timeZone: string;
  stages: RelationshipStage[]; // 先頭が最初の段階（1つ以上）
  stageKey: string; // 今の段階。stages に無ければ先頭の段階として扱う
}

/** stages の中での stageKey の位置。見つからなければ 0（先頭）として扱う（relationship.ts の stageIndex と同じ考え方） */
function resolveStageIndex(stageKey: string, stages: RelationshipStage[]): number {
  const index = stages.findIndex((stage) => stage.key === stageKey);
  return index === -1 ? 0 : index;
}

/**
 * 保存してある状態を now まで進める。順に:
 * ① 終わったセッションがあれば確定して関係値に反映（pendingSession を null に）
 * ② 情動の減衰
 * ③ 疲労の計算・孤独感の増加・familiarity の減衰
 * ④ 気分を（欲求でずらした）平常値へ戻す
 * ⑤ perceptionStageBase を今の段階に合わせ、affectUpdatedAt を now にする
 *
 * now が affectUpdatedAt より前なら経過時間は0として扱う（未来に戻すことはしない）。
 */
export function projectAffectState(
  state: CharacterAffectState,
  now: Date,
  ctx: ProjectAffectStateContext,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): CharacterAffectState {
  const { profile, lifestyle, timeZone, stages, stageKey } = ctx;

  const resolvedStageKey = stages.some((stage) => stage.key === stageKey) ? stageKey : stages[0].key;
  const stageIndexValue = resolveStageIndex(resolvedStageKey, stages);
  const stage = stages[stageIndexValue];

  const elapsedMs = Math.max(0, now.getTime() - new Date(state.affectUpdatedAt).getTime());
  const elapsedHours = elapsedMs / MS_PER_HOUR;
  const elapsedDays = elapsedMs / MS_PER_DAY;

  // ① 終わったセッションがあれば確定して関係値に反映
  let perception = state.perception;
  let perceptionStageBase = state.perceptionStageBase;
  let pendingSession = state.pendingSession;

  if (pendingSession !== null && isSessionEnded(pendingSession, now, config)) {
    perceptionStageBase = resolveStageBase(perceptionStageBase, resolvedStageKey, perception);
    const delta = settleSession(pendingSession);
    perception = applyPerceptionDelta(
      { perception, delta, stage, stageBase: perceptionStageBase.values, profile },
      config
    );
    pendingSession = null;
  }

  // ② 情動の減衰
  const emotions = decayEmotions(state.emotions, elapsedHours, profile, config);

  // ③ 疲労の計算・孤独感の増加・familiarity の減衰
  const fatigue = computeFatigue(lifestyle, timeZone, now, config);
  const loneliness = projectLoneliness(
    state.needs.loneliness,
    elapsedHours,
    { dependence: perception.dependence, stageIndex: stageIndexValue, stageCount: stages.length, profile },
    config
  );
  const familiarity = decayFamiliarity(perception.familiarity, elapsedDays, config);
  perception = { ...perception, familiarity };
  const needs = { fatigue, loneliness };

  // ④ 気分を（欲求でずらした）平常値へ戻す
  const homeBase = computeEffectiveHomeBase(profile, needs, config);
  const mood = decayMoodTowardHomeBase(state.mood, homeBase, elapsedHours, profile, config);

  // ⑤ perceptionStageBase を今の段階に合わせる
  perceptionStageBase = resolveStageBase(perceptionStageBase, resolvedStageKey, perception);

  return {
    emotions,
    mood,
    needs,
    perception,
    perceptionStageBase,
    pendingSession,
    affectUpdatedAt: now.toISOString(),
  };
}
