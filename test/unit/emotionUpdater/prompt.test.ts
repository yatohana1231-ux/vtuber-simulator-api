import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeAll } from "vitest";

import { buildEmotionUpdaterPromptLayers } from "../../../src/emotionUpdater/prompt.js";
import { loadPackage } from "../../../src/lib/packages.js";
import type { EmotionUpdaterPromptInput } from "../../../src/emotionUpdater/prompt.js";
import type { CharacterDefinition, Mood, Perception, World } from "../../../src/types.js";

let world: World;
let character: CharacterDefinition;

beforeAll(async () => {
  const pkg = await loadPackage("yui-modern-tokyo");
  if (!pkg) throw new Error("yui-modern-tokyo package not found");
  world = pkg.world;
  character = pkg.character;
});

function mood(overrides: Partial<Mood> = {}): Mood {
  return { joy: 50, anxiety: 50, angry: 50, fatigue: 50, confidence: 50, loneliness: 50, ...overrides };
}

function perception(overrides: Partial<Perception> = {}): Perception {
  return { trust: 50, affection: 50, respect: 50, fear: 50, dependence: 50, familiarity: 50, ...overrides };
}

function baseInput(overrides: Partial<EmotionUpdaterPromptInput> = {}): EmotionUpdaterPromptInput {
  return {
    world,
    character,
    process: 1,
    currentMood: mood(),
    currentPerception: perception(),
    inputText: "【不在中の出来事】（期間: 2026/09/18(金) 07:00 〜 2026/09/18(金) 19:00）\n1. 雨が降った\n   傘を忘れて濡れた",
    ...overrides,
  };
}

describe("buildEmotionUpdaterPromptLayers", () => {
  it("層ごとの文字列の配列を [固定部, 可変部] の2要素で返す", () => {
    const layers = buildEmotionUpdaterPromptLayers(baseInput());

    expect(layers).toHaveLength(2);
    expect(typeof layers[0]).toBe("string");
    expect(typeof layers[1]).toBe("string");
  });

  describe("固定部（① プロンプトキャッシュのための性質）", () => {
    it("process・感情・関係値・入力が違う2つの入力で、固定部は完全に同じ文字列になる", () => {
      const [fixedA] = buildEmotionUpdaterPromptLayers(baseInput());
      const [fixedB] = buildEmotionUpdaterPromptLayers(
        baseInput({
          process: 2,
          currentMood: mood({ joy: 90, anxiety: 5 }),
          currentPerception: perception({ trust: 10, affection: 95 }),
          inputText: "【プレイヤーの発言】\n今日も配信見てたよ",
        })
      );

      expect(fixedA).toBe(fixedB);
    });

    it("キャラクター名・世界観の説明・出力フォーマットが入る", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(fixed).toContain(character.name);
      expect(fixed).toContain(world.description);
      expect(fixed).toContain("moodDelta");
      expect(fixed).toContain("perceptionDelta");
    });

    it("現在の感情状態・関係値・更新のインプットが入らない", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(fixed).not.toContain("雨が降った");
      expect(fixed).not.toContain("喜び：50");
      expect(fixed).not.toContain("±0〜3");
      expect(fixed).not.toContain("±1〜5");
    });
  });

  describe("可変部（③ 毎回変わる入力）", () => {
    it("現在の感情状態・関係値が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(
        baseInput({ currentMood: mood({ joy: 20 }), currentPerception: perception({ trust: 61 }) })
      );

      expect(variable).toContain("喜び：20（ほとんど感じない）");
      expect(variable).toContain("信頼：61（自覚している）");
    });

    it("更新のインプットが入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(variable).toContain("雨が降った");
      expect(variable).toContain("傘を忘れて濡れた");
    });

    it("process=1 → 「±0〜3」の関係値のルールが入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ process: 1 }));

      expect(variable).toContain("±0〜3");
      expect(variable).not.toContain("±1〜5");
    });

    it("process=2 → 「±1〜5」の関係値のルールが入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ process: 2 }));

      expect(variable).toContain("±1〜5");
      expect(variable).not.toContain("±0〜3");
    });

    it("出力フォーマットを守るよう促す念押しの一文が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(variable).toContain("出力フォーマット");
      expect(variable).toContain("JSON だけを出力してください");
    });

    it("日付の「/」がHTMLエスケープされていない（&#x2F;を含まない）", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(variable).not.toContain("&#x2F;");
    });
  });

  describe("テンプレートに世界観・キャラクターに依存する語が直書きされていない", () => {
    const forbiddenWords = ["高校", "学校", "東京", "配信"];

    it.each(["emotionUpdater.fixed.mustache", "emotionUpdater.variable.mustache"])(
      "%s",
      (fileName) => {
        const templatePath = fileURLToPath(
          new URL(`../../../src/emotionUpdater/prompts/${fileName}`, import.meta.url)
        );
        const raw = readFileSync(templatePath, "utf8");

        for (const word of forbiddenWords) {
          expect(raw).not.toContain(word);
        }
      }
    );
  });
});
