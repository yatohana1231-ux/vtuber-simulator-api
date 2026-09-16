// -------------------------------------------------------
// 5つのプロンプトで共有するパーシャルと、その描画に使う値
// -------------------------------------------------------

import SPEECH_EXAMPLES_PARTIAL from "./speechExamples.mustache";
import WORLD_PARTIAL from "./world.mustache";
import type { CharacterDefinition, World } from "../types.js";

/** Mustache.render の第3引数に渡す。テンプレートからは {{> world}} / {{> speechExamples}} で読み込む */
export const PROMPT_PARTIALS = {
  world: WORLD_PARTIAL,
  speechExamples: SPEECH_EXAMPLES_PARTIAL,
};

/** 各テンプレートの view に展開する、世界観・キャラクター由来の値 */
export function buildPromptContext(world: World, character: CharacterDefinition) {
  return {
    world,
    character,
    hasForbiddenElements: world.forbiddenElements.length > 0,
    forbiddenElementsText: world.forbiddenElements.join("、"),
    hasSpeechExamples: character.speechExamples.length > 0,
  };
}
