// -------------------------------------------------------
// emotionUpdater のシステムプロンプトの組み立て（D-040）
//
// プロンプトキャッシュ（D-017・D-022）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（emotionUpdater.fixed.mustache）: 同じパッケージなら process や状態に
//   よらず毎回まったく同じ文字列。感情・記憶・入力・process 固有のルールは入れない。
// - ③ 可変部（emotionUpdater.variable.mustache）: 今の状態・関係の段階の説明・
//   最近の会話（process=2 だけ）・評価するインプット・process ごとのルールなど、
//   毎回変わる入力。
// emotionUpdater には②（セッション部）は無い。
//
// D-040 で、LLM の役割が「差分の算出」から「出来事の評価（分類）」に変わったため、
// 出力フォーマットも appraisals/interaction になった（旧 moodDelta/perceptionDelta は廃止）。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/emotionUpdater.fixed.mustache";
import VARIABLE_TEMPLATE from "./prompts/emotionUpdater.variable.mustache";
import { buildPromptContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import type { CharacterDefinition, World } from "../types.js";

export interface EmotionUpdaterPromptInput {
  world: World;
  character: CharacterDefinition;
  process: 1 | 2;
  affectText: string; // 今のキャラクターの状態（formatAffectForPrompt の結果）
  stageDescription: string; // 今の関係の段階の説明（RelationshipStage.description）
  recentConversationText: string; // 直近の会話（process=2 だけ。空文字なら節ごと出さない）
  inputText: string; // 評価する入力（process1: 不在中の出来事・行動、process2: プレイヤーの発言）
}

/** emotionUpdater のシステムプロンプトを、層ごとの文字列の配列 [固定部, 可変部] で返す（D-017・D-022・D-040） */
export function buildEmotionUpdaterPromptLayers(input: EmotionUpdaterPromptInput): string[] {
  const { world, character, process, affectText, stageDescription, recentConversationText, inputText } = input;

  const fixedContext = {
    ...buildPromptContext(world, character),
    goals: character.goals ?? [],
  };
  const fixed = Mustache.render(FIXED_TEMPLATE, fixedContext, PROMPT_PARTIALS);

  const processRule =
    process === 1
      ? '- 入力は、プレイヤーがいなかった間の出来事です。プレイヤーが原因の出来事でなければ cause を "player" にしないこと。interaction は出力しないこと。'
      : "- 入力は、プレイヤーの発言です。【最近の会話】は流れをつかむための参考で、評価するのは【評価する入力】の発言だけです。";

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    affectText,
    stageDescription,
    hasRecentConversation: recentConversationText.length > 0,
    recentConversationText,
    inputText,
    processRule,
  });

  return [fixed, variable];
}
