// -------------------------------------------------------
// emotionUpdater のシステムプロンプトの組み立て
//
// プロンプトキャッシュ（D-017・D-022）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（emotionUpdater.fixed.mustache）: 同じパッケージなら process によらず毎回まったく同じ文字列。
//   感情・記憶・入力・process 固有のルールは入れない。
// - ③ 可変部（emotionUpdater.variable.mustache）: 現在の感情状態・関係値・更新のインプット・
//   process ごとの関係値のルールなど、毎回変わる入力。
// emotionUpdater には②（セッション部）は無い（process=1 の入力は最新の不在期間の記録の
// テキストとして③に入る）。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/emotionUpdater.fixed.mustache";
import VARIABLE_TEMPLATE from "./prompts/emotionUpdater.variable.mustache";
import { buildPromptContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import { formatMoodForPrompt, formatPerceptionForPrompt } from "../lib/characterStateText.js";
import type { CharacterDefinition, Mood, Perception, World } from "../types.js";

export interface EmotionUpdaterPromptInput {
  world: World;
  character: CharacterDefinition;
  process: 1 | 2;
  currentMood: Mood;
  currentPerception: Perception;
  inputText: string; // 更新のインプット（process1: 不在中の出来事・行動、process2: プレイヤーの発言）
}

/** emotionUpdater のシステムプロンプトを、層ごとの文字列の配列 [固定部, 可変部] で返す（D-017・D-022） */
export function buildEmotionUpdaterPromptLayers(input: EmotionUpdaterPromptInput): string[] {
  const { world, character, process, currentMood, currentPerception, inputText } = input;

  const fixed = Mustache.render(FIXED_TEMPLATE, buildPromptContext(world, character), PROMPT_PARTIALS);

  const perceptionRule =
    process === 1
      ? "- 関係値（perception）はプレイヤー不在中の出来事なので、大きく変化しないよう差分を小さく抑えること（目安: ±0〜3）"
      : "- 関係値（perception）もプレイヤーの発言に応じて適切に更新する（目安: ±1〜5）";

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    moodText: formatMoodForPrompt(currentMood),
    perceptionText: formatPerceptionForPrompt(currentPerception),
    inputText,
    perceptionRule,
  });

  return [fixed, variable];
}
