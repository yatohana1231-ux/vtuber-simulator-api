// -------------------------------------------------------
// シナリオの state.affect（部分的な感情・関係値の状態）から、
// 完全な CharacterAffectState を組み立てる（D-040 フェーズ16a）。
//
// 省略した項目は、本番と同じ計算（createInitialAffectState + resolveAffectProfile）で埋める。
// LLM も DB も使わない純粋な関数の組み合わせなので、cli.ts が env（CONTENT_DIR など）を
// 設定する前に import しても安全（fakeDynamo.ts・execute.ts の両方から、
// トップレベルの静的 import で使う）。
// -------------------------------------------------------

import { createInitialAffectState } from "../../../src/lib/affect/affectProjection.js";
import { resolveAffectProfile } from "../../../src/lib/affect/personality.js";
import type { CharacterAffectState, CharacterDefinition, Emotions, Needs } from "../../../src/types.js";
import type { ScenarioAffectState } from "./types.js";

/**
 * シナリオの state.affect（部分的、省略可）から、完全な CharacterAffectState を組み立てる。
 * `affect` が undefined なら、キャラクターの初期状態（createInitialAffectState）をそのまま返す。
 * `now` は affect.affectUpdatedAt を省略したときの既定値（実行開始時刻）と、
 * 初期状態の affectUpdatedAt に使う。すでに ISO8601 に解決済み（resolveScenarioDatetimes 後）の
 * 値を渡すこと。
 */
export function buildScenarioAffectState(
  character: CharacterDefinition,
  affect: ScenarioAffectState | undefined,
  now: Date
): CharacterAffectState {
  const profile = resolveAffectProfile(character);
  const initial = createInitialAffectState(character, profile, now);
  if (!affect) return initial;

  const emotions: Emotions = { ...initial.emotions, ...(affect.emotions ?? {}) };
  const needs: Needs = { ...initial.needs, ...(affect.needs ?? {}) };

  return {
    emotions,
    mood: affect.mood ?? initial.mood,
    needs,
    perception: affect.perception ?? initial.perception,
    perceptionStageBase: null,
    pendingSession: affect.pendingSession !== undefined ? affect.pendingSession : initial.pendingSession,
    affectUpdatedAt: affect.affectUpdatedAt ?? now.toISOString(),
  };
}
