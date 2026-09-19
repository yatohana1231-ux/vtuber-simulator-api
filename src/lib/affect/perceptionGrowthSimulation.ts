// -------------------------------------------------------
// 関係値（perception）の伸び方の試算（D-040 フェーズ15）
//
// affectConfig.ts の設定値（perception.gainScale・dampingSigma）や
// キャラクターの各段階の maxPerception・promoteWhen を変えたときに、
// 「毎日決まった量だけ話すと、各段階に何日で上がるか」を確かめるための、
// 純粋な関数（LLM も DB も使わない。現在時刻も使わない）。
//
// 1セッション（会話のまとまり）で確定する差分（sessionDelta。上限・減衰が
// かかる前の値。sessionAccumulator.ts の settleSession が返すのと同じ形）を、
// 1日に sessionsPerDay 回 applyPerceptionDelta で当てていく。1日の終わりに
// 次の段階の条件（関係値の下限・会話した日数/回数）を見て、両方を満たして
// いれば次の段階に上がったとみなす（段階の下端は resolveStageBase で、
// 段階に入ったときの関係値に作り直す。perceptionDynamics.ts と同じ規則）。
// -------------------------------------------------------

import type { AffectConfig } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG } from "./affectConfig.js";
import { resolveAffectProfile } from "./personality.js";
import { applyPerceptionDelta, resolveStageBase } from "./perceptionDynamics.js";
import type {
  CharacterDefinition,
  Perception,
  PerceptionContribution,
  PerceptionStageBase,
  RelationshipStagePromotion,
} from "../../types.js";

export interface PerceptionGrowthSimulationInput {
  character: CharacterDefinition;
  /** 1セッションで確定する差分（上限・減衰がかかる前。settleSession が返す形と同じ） */
  sessionDelta: PerceptionContribution;
  /** 1日あたりのセッション数。既定 1 */
  sessionsPerDay?: number;
  /** 1セッションあたりのメッセージ数（履歴の条件 minConversationCount の判定に使う）。既定 10 */
  messagesPerSession?: number;
  /** 打ち切り日数（この日数までに次の段階の条件を満たさなければ、その段階で終わる）。既定 365 */
  maxDays?: number;
}

export interface PerceptionGrowthStageResult {
  stageKey: string;
  stageLabel: string;
  /** この段階に入った日（最初の段階は 0） */
  enteredOnDay: number;
  /** 次の段階の minPerception を満たした日（最後の段階、または maxDays までに満たさなければ null） */
  perceptionConditionMetOnDay: number | null;
  /** 次の段階の履歴の条件（minConversationDays・minConversationCount）を満たした日（同上） */
  historyConditionMetOnDay: number | null;
  /** 次の段階に上がった日（関係値・履歴の両方を満たした日。同上） */
  promotedOnDay: number | null;
  /** この段階を出るとき（上がれなければ maxDays の時点）の関係値 */
  perceptionAtEnd: Perception;
}

/** promotion.minPerception の軸をすべて満たしているか */
function meetsMinPerception(minPerception: RelationshipStagePromotion["minPerception"], perception: Perception): boolean {
  for (const key of Object.keys(minPerception) as Array<keyof Perception>) {
    const minValue = minPerception[key];
    if (minValue !== undefined && perception[key] < minValue) return false;
  }
  return true;
}

export function simulatePerceptionGrowth(
  input: PerceptionGrowthSimulationInput,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): PerceptionGrowthStageResult[] {
  const { character, sessionDelta } = input;
  const sessionsPerDay = input.sessionsPerDay ?? 1;
  const messagesPerSession = input.messagesPerSession ?? 10;
  const maxDays = input.maxDays ?? 365;

  const profile = resolveAffectProfile(character, config);
  const stages = character.relationshipStages;

  let perception: Perception = { ...character.initialPerception };
  let stageBase: PerceptionStageBase | null = null;
  let conversationDays = 0;
  let conversationCount = 0;
  // 経過日数の累計（段階をまたいでも 0 に戻さない。1つ目の段階は 0 日目に入る）
  let day = 0;

  const results: PerceptionGrowthStageResult[] = [];

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    const stage = stages[stageIndex];
    const next = stages[stageIndex + 1] ?? null;
    stageBase = resolveStageBase(stageBase, stage.key, perception);
    const enteredOnDay = day;

    let perceptionConditionMetOnDay: number | null = null;
    let historyConditionMetOnDay: number | null = null;
    let promotedOnDay: number | null = null;

    while (day < maxDays) {
      day += 1;

      for (let session = 0; session < sessionsPerDay; session++) {
        perception = applyPerceptionDelta(
          { perception, delta: sessionDelta, stage, stageBase: stageBase.values, profile },
          config
        );
      }
      if (sessionsPerDay > 0) {
        conversationDays += 1;
        conversationCount += sessionsPerDay * messagesPerSession;
      }

      if (next && next.promoteWhen) {
        const promoteWhen = next.promoteWhen;
        const perceptionOk = meetsMinPerception(promoteWhen.minPerception, perception);
        if (perceptionOk && perceptionConditionMetOnDay === null) {
          perceptionConditionMetOnDay = day;
        }
        const historyOk =
          conversationDays >= promoteWhen.minConversationDays && conversationCount >= promoteWhen.minConversationCount;
        if (historyOk && historyConditionMetOnDay === null) {
          historyConditionMetOnDay = day;
        }
        if (perceptionOk && historyOk) {
          promotedOnDay = day;
          break;
        }
      }
    }

    results.push({
      stageKey: stage.key,
      stageLabel: stage.label,
      enteredOnDay,
      perceptionConditionMetOnDay,
      historyConditionMetOnDay,
      promotedOnDay,
      perceptionAtEnd: { ...perception },
    });

    // 最後の段階、または maxDays までに次の段階へ上がれなかった場合はここで終わる
    if (!next || promotedOnDay === null) break;
  }

  return results;
}
