import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeAll } from "vitest";

import { buildMemoryRetrieverPromptLayers } from "../../../src/memoryRetriever/prompt.js";
import { loadPackage } from "../../../src/lib/packages.js";
import type { MemoryRetrieverPromptInput } from "../../../src/memoryRetriever/prompt.js";
import type { CharacterDefinition, World } from "../../../src/types.js";

let world: World;
let character: CharacterDefinition;

beforeAll(async () => {
  const pkg = await loadPackage("yui-modern-tokyo");
  if (!pkg) throw new Error("yui-modern-tokyo package not found");
  world = pkg.world;
  character = pkg.character;
});

function baseInput(overrides: Partial<MemoryRetrieverPromptInput> = {}): MemoryRetrieverPromptInput {
  return {
    world,
    character,
    existingMemoriesText: "[index:mem-1] 文化祭の準備を手伝った（楽しかった）",
    inputText:
      "【不在中の出来事】（期間: 2026/09/18(金) 07:00 〜 2026/09/18(金) 19:00）\n1. 雨が降った\n   傘を忘れて濡れた",
    ...overrides,
  };
}

describe("buildMemoryRetrieverPromptLayers", () => {
  it("層ごとの文字列の配列を [固定部, 可変部] の2要素で返す", () => {
    const layers = buildMemoryRetrieverPromptLayers(baseInput());

    expect(layers).toHaveLength(2);
    expect(typeof layers[0]).toBe("string");
    expect(typeof layers[1]).toBe("string");
  });

  describe("固定部（① プロンプトキャッシュのための性質）", () => {
    it("既存の重要記憶・判定対象の出来事が違う2つの入力で、固定部は完全に同じ文字列になる", () => {
      const [fixedA] = buildMemoryRetrieverPromptLayers(baseInput());
      const [fixedB] = buildMemoryRetrieverPromptLayers(
        baseInput({
          existingMemoriesText: "（なし）",
          inputText: "【直近の会話（5往復）】\nプレイヤー: 配信見たよ\nテストキャラ: ありがとう",
        })
      );

      expect(fixedA).toBe(fixedB);
    });

    it("キャラクター名・世界観の説明・保存基準・整合性ラベル・出力フォーマットが入る", () => {
      const [fixed] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(fixed).toContain(character.name);
      expect(fixed).toContain(world.description);
      expect(fixed).toContain("CREATE");
      expect(fixed).toContain("UPDATE");
      expect(fixed).toContain("IGNORE");
      expect(fixed).toContain("CONFLICT");
      expect(fixed).toContain("memoryType");
      expect(fixed).toContain("candidates");
    });

    it("emotionValenceの出力形式と説明が入る（D-040 フェーズ13a）", () => {
      const [fixed] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(fixed).toContain('"emotionValence": "positive | negative | neutral"');
      expect(fixed).toContain("emotionValence");
      expect(fixed).toContain("positive");
      expect(fixed).toContain("negative");
      expect(fixed).toContain("neutral");
    });

    it("入力が違っても固定部のemotionValenceの説明は完全に同じ文字列になる", () => {
      const [fixedA] = buildMemoryRetrieverPromptLayers(baseInput());
      const [fixedB] = buildMemoryRetrieverPromptLayers(
        baseInput({
          existingMemoriesText: "（なし）",
          inputText: "【直近の会話（5往復）】\nプレイヤー: 配信見たよ\nテストキャラ: ありがとう",
        })
      );

      expect(fixedA).toBe(fixedB);
      expect(fixedA).toContain('"emotionValence": "positive | negative | neutral"');
    });

    it("既存の重要記憶・判定対象の出来事が入らない", () => {
      const [fixed] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(fixed).not.toContain("雨が降った");
      expect(fixed).not.toContain("文化祭の準備を手伝った");
    });
  });

  describe("可変部（③ 毎回変わる入力）", () => {
    it("既存の重要記憶が入る", () => {
      const [, variable] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(variable).toContain("文化祭の準備を手伝った");
    });

    it("既存の重要記憶が無い → 「（なし）」", () => {
      const [, variable] = buildMemoryRetrieverPromptLayers(baseInput({ existingMemoriesText: "（なし）" }));

      expect(variable).toContain("【既存の重要記憶】\n（なし）");
    });

    it("判定対象の出来事が入る", () => {
      const [, variable] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(variable).toContain("雨が降った");
      expect(variable).toContain("傘を忘れて濡れた");
    });

    it("出力フォーマットを守るよう促す念押しの一文が入る", () => {
      const [, variable] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(variable).toContain("出力フォーマット");
      expect(variable).toContain("JSON だけを出力してください");
    });

    it("日付の「/」がHTMLエスケープされていない（&#x2F;を含まない）", () => {
      const [, variable] = buildMemoryRetrieverPromptLayers(baseInput());

      expect(variable).not.toContain("&#x2F;");
    });
  });

  describe("テンプレートに世界観・キャラクターに依存する語が直書きされていない", () => {
    const forbiddenWords = ["高校", "学校", "東京", "配信"];

    it.each(["memoryRetriever.fixed.mustache", "memoryRetriever.variable.mustache"])(
      "%s",
      (fileName) => {
        const templatePath = fileURLToPath(
          new URL(`../../../src/memoryRetriever/prompts/${fileName}`, import.meta.url)
        );
        const raw = readFileSync(templatePath, "utf8");

        for (const word of forbiddenWords) {
          expect(raw).not.toContain(word);
        }
      }
    );
  });
});
