// -------------------------------------------------------
// 5つのプロンプトで共有するパーシャルと、その描画に使う値
// -------------------------------------------------------

import SPEECH_EXAMPLES_PARTIAL from "./speechExamples.mustache";
import WORLD_PARTIAL from "./world.mustache";
import type { CharacterDefinition, SpeechExample, World } from "../types.js";

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
  };
}

/**
 * speechExamples パーシャルに渡す view。呼び出し元が「どの例文を使うか」
 * （dialogueGenerator では段階の speechExamples、無ければ character.speechExamples）を
 * 決めたうえで渡す（D-033）。examples が空なら hasSpeechExamples が false になり、
 * パーシャルは何も出力しない。
 */
export function buildSpeechExamplesContext(characterName: string, examples: SpeechExample[]) {
  return {
    characterName,
    hasSpeechExamples: examples.length > 0,
    speechExamples: examples,
  };
}
