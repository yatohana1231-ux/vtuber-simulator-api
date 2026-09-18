import { describe, it, expect } from "vitest";
import { PROMPT_PARTIALS, buildPromptContext } from "../../../src/promptPartials/index.js";
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

  it("speechExamplesが空配列 → hasSpeechExamplesはfalse", () => {
    const ctx = buildPromptContext(baseWorld, baseCharacter);
    expect(ctx.hasSpeechExamples).toBe(false);
  });

  it("speechExamplesが1件以上 → hasSpeechExamplesはtrue", () => {
    const character: CharacterDefinition = {
      ...baseCharacter,
      speechExamples: [{ player: "こんにちは", reply: "やっほー！" }],
    };
    const ctx = buildPromptContext(baseWorld, character);
    expect(ctx.hasSpeechExamples).toBe(true);
  });
});
