import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeAll } from "vitest";

import { buildEmotionUpdaterPromptLayers } from "../../../src/emotionUpdater/prompt.js";
import { loadPackage } from "../../../src/lib/packages.js";
import type { EmotionUpdaterPromptInput } from "../../../src/emotionUpdater/prompt.js";
import type { CharacterDefinition, World } from "../../../src/types.js";

let world: World;
let character: CharacterDefinition;
let characterWithoutGoals: CharacterDefinition;

beforeAll(async () => {
  const pkg = await loadPackage("yui-modern-tokyo");
  if (!pkg) throw new Error("yui-modern-tokyo package not found");
  world = pkg.world;
  character = pkg.character;
  characterWithoutGoals = { ...pkg.character, goals: undefined };
});

function baseInput(overrides: Partial<EmotionUpdaterPromptInput> = {}): EmotionUpdaterPromptInput {
  return {
    world,
    character,
    process: 1,
    affectText: "・今の気分：ふつう（特に偏りはない）\n・いま強く感じていること：特になし\n・疲労：30（少し）\n・孤独感：0（ほとんど感じない）",
    stageDescription: "テスト用の関係の段階の説明",
    recentConversationText: "",
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
    it("process・状態が違う2つの入力で、固定部は完全に同じ文字列になる", () => {
      const [fixedA] = buildEmotionUpdaterPromptLayers(baseInput());
      const [fixedB] = buildEmotionUpdaterPromptLayers(
        baseInput({
          process: 2,
          affectText: "・今の気分：とても、はつらつとして前向き\n・いま強く感じていること：喜び 90（強く）\n・疲労：80（かなり）\n・孤独感：60（そこそこ）",
          stageDescription: "別の段階の説明",
          recentConversationText: "プレイヤー: やあ\nテストキャラ: こんにちは",
          inputText: "【プレイヤーの発言】\n今日も配信見てたよ",
        })
      );

      expect(fixedA).toBe(fixedB);
    });

    it("キャラクター名・世界観の説明・出力フォーマットが入る", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(fixed).toContain(character.name);
      expect(fixed).toContain(world.description);
      expect(fixed).toContain("appraisals");
      expect(fixed).toContain("interaction");
    });

    it("goalsが入る", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(character.goals && character.goals.length).toBeGreaterThan(0);
      for (const goal of character.goals ?? []) {
        expect(fixed).toContain(goal.key);
        expect(fixed).toContain(goal.description);
      }
    });

    it("goalsが無ければ「（特になし）」が入る", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput({ character: characterWithoutGoals }));

      expect(fixed).toContain("（特になし）");
    });

    it("今の状態・関係の段階の説明・更新のインプットが入らない", () => {
      const [fixed] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(fixed).not.toContain("雨が降った");
      expect(fixed).not.toContain("テスト用の関係の段階の説明");
      expect(fixed).not.toContain("今の気分：ふつう");
    });
  });

  describe("可変部（③ 毎回変わる入力）", () => {
    it("今の状態（affectText）が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(variable).toContain("今の気分：ふつう");
    });

    it("関係の段階の説明（stageDescription）が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ stageDescription: "とても親しい間柄" }));

      expect(variable).toContain("とても親しい間柄");
    });

    it("評価する入力（inputText）が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput());

      expect(variable).toContain("雨が降った");
      expect(variable).toContain("傘を忘れて濡れた");
    });

    it("最近の会話があれば【最近の会話】の節に入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(
        baseInput({ recentConversationText: "プレイヤー: やあ\nテストキャラ: こんにちは" })
      );

      expect(variable).toContain("【最近の会話】");
      expect(variable).toContain("プレイヤー: やあ");
    });

    it("最近の会話が空なら【最近の会話】の節が出ない", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ recentConversationText: "" }));

      expect(variable).not.toContain("【最近の会話】");
    });

    it("process=1 → process=1向けのルール（player以外をcause playerにしない・interactionを出さない）が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ process: 1 }));

      expect(variable).toContain("プレイヤーがいなかった間の出来事");
      expect(variable).toContain("interaction は出力しないこと");
    });

    it("process=2 → process=2向けのルール（最近の会話は参考、評価は入力の発言だけ）が入る", () => {
      const [, variable] = buildEmotionUpdaterPromptLayers(baseInput({ process: 2 }));

      expect(variable).toContain("プレイヤーの発言です");
      expect(variable).toContain("評価するのは【評価する入力】の発言だけ");
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

    it.each(["emotionUpdater.fixed.mustache", "emotionUpdater.variable.mustache"])("%s", (fileName) => {
      const templatePath = fileURLToPath(new URL(`../../../src/emotionUpdater/prompts/${fileName}`, import.meta.url));
      const raw = readFileSync(templatePath, "utf8");

      for (const word of forbiddenWords) {
        expect(raw).not.toContain(word);
      }
    });
  });
});
