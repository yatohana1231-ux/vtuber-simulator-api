// -------------------------------------------------------
// memoryRetriever のシステムプロンプトの組み立て
//
// プロンプトキャッシュ（D-017・D-022）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（memoryRetriever.fixed.mustache）: 同じパッケージなら process によらず毎回まったく同じ文字列。
//   既存の重要記憶・判定対象の出来事は入れない。
// - ③ 可変部（memoryRetriever.variable.mustache）: 既存の重要記憶・判定対象の出来事など、毎回変わる入力。
// memoryRetriever には②（セッション部）は無い（process=1 の入力は最新の不在期間の記録の
// テキストとして③に入る）。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/memoryRetriever.fixed.mustache";
import VARIABLE_TEMPLATE from "./prompts/memoryRetriever.variable.mustache";
import { buildPromptContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import type { CharacterDefinition, World } from "../types.js";

export interface MemoryRetrieverPromptInput {
  world: World;
  character: CharacterDefinition;
  existingMemoriesText: string;
  inputText: string; // 判定対象の出来事（process1: 不在中の出来事・行動、process2: 直近の会話）
}

/** memoryRetriever のシステムプロンプトを、層ごとの文字列の配列 [固定部, 可変部] で返す（D-017・D-022） */
export function buildMemoryRetrieverPromptLayers(input: MemoryRetrieverPromptInput): string[] {
  const { world, character, existingMemoriesText, inputText } = input;

  const fixed = Mustache.render(FIXED_TEMPLATE, buildPromptContext(world, character), PROMPT_PARTIALS);

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    existingMemoriesText,
    inputText,
  });

  return [fixed, variable];
}
