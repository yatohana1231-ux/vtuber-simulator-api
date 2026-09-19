import { describe, it, expect } from "vitest";
import { PROMPT_PARTIALS, buildPromptContext, buildSpeechExamplesContext } from "../../../src/promptPartials/index.js";
import type { CharacterDefinition, World } from "../../../src/types.js";

// .mustache 変換プラグイン（vitest.config.ts）が機能していることの確認も兼ねる。
// PROMPT_PARTIALS.world / .speechExamples は .mustache ファイルを文字列 import した結果。

describe("PROMPT_PARTIALS", () => {
  it(".mustacheファイルをimportする → 空でない文字列になる（.mustache変換プラグインの動作確認）", () => {
    expect(typeof PROMPT_PARTIALS.world).toBe("string");
    expect(PROMPT_PARTIALS.world.length).toBeGreaterThan(0);
    expect(typeof PROMPT_PARTIALS.speechExamples).toBe("string");
    expect(PROMPT_PARTIALS.speechExamples.length).toBeGreaterThan(0);
  });
});

describe("buildPromptContext", () => {
  const baseWorld: World = {
    key: "test-world",
    name: "テスト世界",
    description: "テスト用の世界観",
    rules: ["ルール1"],
    forbiddenElements: [],
    timezone: "Asia/Tokyo",
  };

  const baseCharacter: CharacterDefinition = {
    key: "test-character",
    name: "テストキャラ",
    personality: "明るい",
    speechStyle: "丁寧語",
    relationship: "友人",
    background: "テスト用の背景設定",
    speechExamples: [],
    initialPerception: {
      trust: 50,
      affection: 50,
      respect: 50,
      fear: 10,
      dependence: 10,
      familiarity: 50,
    },
    relationshipStages: [
      {
        key: "first",
        label: "テスト段階",
        description: "テスト用の説明",
        speechStyle: "テスト用の話し方",
        speechExamples: [],
        promoteWhen: null,
      },
    ],
  };

  it("forbiddenElementsが空配列 → hasForbiddenElementsはfalse、forbiddenElementsTextは空文字", () => {
    const ctx = buildPromptContext(baseWorld, baseCharacter);
    expect(ctx.hasForbiddenElements).toBe(false);
    expect(ctx.forbiddenElementsText).toBe("");
  });

  it("forbiddenElementsに複数要素 → hasForbiddenElementsはtrue、forbiddenElementsTextは「、」区切りで連結される", () => {
    const world: World = {
      ...baseWorld,
      forbiddenElements: ["暴力表現", "政治的発言"],
    };
    const ctx = buildPromptContext(world, baseCharacter);
    expect(ctx.hasForbiddenElements).toBe(true);
    expect(ctx.forbiddenElementsText).toBe("暴力表現、政治的発言");
  });
});

describe("buildSpeechExamplesContext", () => {
  it("examplesが空配列 → hasSpeechExamplesはfalseで、speechExamplesは空配列のまま返す", () => {
    const ctx = buildSpeechExamplesContext("テストキャラ", []);
    expect(ctx.hasSpeechExamples).toBe(false);
    expect(ctx.speechExamples).toEqual([]);
    expect(ctx.characterName).toBe("テストキャラ");
  });

  it("examplesが1件以上 → hasSpeechExamplesはtrueで、渡した配列がそのまま入る", () => {
    const examples = [{ player: "こんにちは", reply: "やっほー！" }];
    const ctx = buildSpeechExamplesContext("テストキャラ", examples);
    expect(ctx.hasSpeechExamples).toBe(true);
    expect(ctx.speechExamples).toEqual(examples);
  });
});
