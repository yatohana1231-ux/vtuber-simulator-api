import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeAll } from "vitest";

import { buildDialogueGeneratorPromptLayers } from "../../../src/dialogueGenerator/prompt.js";
import { loadPackage } from "../../../src/lib/packages.js";
import type { DialogueGeneratorPromptInput } from "../../../src/dialogueGenerator/prompt.js";
import type {
  AbsenceRecord,
  CharacterDefinition,
  CharacterMemoryItem,
  World,
} from "../../../src/types.js";

let world: World;
let character: CharacterDefinition;

beforeAll(async () => {
  const pkg = await loadPackage("yui-modern-tokyo");
  if (!pkg) throw new Error("yui-modern-tokyo package not found");
  world = pkg.world;
  character = pkg.character;
});

function absenceRecord(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "char-1",
    createdAt: "2026-09-18T10:00:00.000Z",
    startDatetime: "2026-09-17T22:00:00.000Z",
    endDatetime: "2026-09-18T10:00:00.000Z",
    events: [
      { kind: "daily", summary: "授業で発表したマーカー要約", detail: "緊張したけど上手くいったマーカー詳細" },
    ],
    actions: [
      {
        startDatetime: "2026-09-17T22:00:00.000Z",
        endDatetime: "2026-09-17T22:30:00.000Z",
        action: "起床マーカー行動",
        memo: "眠そうだったマーカーメモ",
      },
    ],
    threads: [
      { id: "thread-open", topic: "続いている話題マーカー", status: "open", openedAt: "2026-09-15T10:00:00.000Z" },
      { id: "thread-closed", topic: "終わった話題マーカー", status: "closed", openedAt: "2026-09-10T10:00:00.000Z" },
    ],
    ...overrides,
  };
}

function memory(overrides: Partial<CharacterMemoryItem> = {}): CharacterMemoryItem {
  return {
    memory_id: "char-1",
    index: "mem-1",
    eventSummary: "文化祭の準備を手伝った",
    characterInterpretation: "楽しかった",
    ...overrides,
  };
}

function baseInput(overrides: Partial<DialogueGeneratorPromptInput> = {}): DialogueGeneratorPromptInput {
  return {
    world,
    character,
    mood: { joy: 50, anxiety: 50, angry: 50, fatigue: 50, confidence: 50, loneliness: 50 },
    perception: { trust: 50, affection: 50, respect: 50, fear: 50, dependence: 50, familiarity: 50 },
    memories: [memory()],
    historyLogs: [{ role: "user", content: "こんにちは", index: "2026-09-18T10:00:00.000Z" }],
    latestAbsenceRecord: absenceRecord(),
    now: new Date("2026-09-18T10:30:00.000Z"),
    longTimeFlag: 0,
    ...overrides,
  };
}

describe("buildDialogueGeneratorPromptLayers", () => {
  it("層ごとの文字列の配列を [固定部, セッション部, 可変部] の3要素で返す", () => {
    const layers = buildDialogueGeneratorPromptLayers(baseInput());

    expect(layers).toHaveLength(3);
    expect(typeof layers[0]).toBe("string");
    expect(typeof layers[1]).toBe("string");
    expect(typeof layers[2]).toBe("string");
  });

  describe("固定部（① プロンプトキャッシュのための性質）", () => {
    it("感情・記憶・会話・現在時刻・記録・長期不在フラグが違う2つの入力で、固定部は完全に同じ文字列になる", () => {
      const [fixedA] = buildDialogueGeneratorPromptLayers(baseInput());
      const [fixedB] = buildDialogueGeneratorPromptLayers(
        baseInput({
          mood: { joy: 1, anxiety: 2, angry: 3, fatigue: 4, confidence: 5, loneliness: 6 },
          perception: { trust: 1, affection: 2, respect: 3, fear: 4, dependence: 5, familiarity: 6 },
          memories: [],
          historyLogs: [],
          latestAbsenceRecord: null,
          now: new Date("2026-01-01T00:00:00.000Z"),
          longTimeFlag: 1,
        })
      );

      expect(fixedA).toBe(fixedB);
    });

    it("キャラクター名・世界観の説明・口調の例文が入る", () => {
      const [fixed] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(fixed).toContain(character.name);
      expect(fixed).toContain(world.description);
    });

    it("日時の表記が入らない（YYYY/MM/DD(曜) 形式が含まれない）", () => {
      const [fixed] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(fixed).not.toMatch(/\d{4}\/\d{2}\/\d{2}\([日月火水木金土]\)/);
    });
  });

  describe("セッション部（② 最新の不在期間の記録）", () => {
    it("同じ記録なら now・mood・会話が違っても同じ文字列になる", () => {
      const [, sessionA] = buildDialogueGeneratorPromptLayers(baseInput());
      const [, sessionB] = buildDialogueGeneratorPromptLayers(
        baseInput({
          mood: { joy: 99, anxiety: 99, angry: 99, fatigue: 99, confidence: 99, loneliness: 99 },
          now: new Date("2026-01-01T00:00:00.000Z"),
          historyLogs: [],
        })
      );

      expect(sessionA).toBe(sessionB);
    });

    it("記録が無い（null） → 空文字になる", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput({ latestAbsenceRecord: null }));

      expect(session).toBe("");
    });

    it("出来事の summary・detail が入る", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).toContain("授業で発表したマーカー要約");
      expect(session).toContain("緊張したけど上手くいったマーカー詳細");
    });

    it("行動が入る", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).toContain("起床マーカー行動");
      expect(session).toContain("眠そうだったマーカーメモ");
    });

    it("openの話題が入る", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).toContain("続いている話題マーカー");
    });

    it("closedの話題は入らない", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).not.toContain("終わった話題マーカー");
    });

    it("threadIdが入らない", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).not.toContain("thread-open");
      expect(session).not.toContain("thread-closed");
    });

    it("kindが入らない", () => {
      const [, session] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(session).not.toContain("daily");
    });
  });

  describe("可変部（③ 毎回変わる入力）", () => {
    it("現在時刻が世界観のタイムゾーン表記で入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).toContain("2026/09/18(金) 19:30");
    });

    it("感情のラベルが入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).toContain("喜び：50（標準）");
      expect(variable).toContain("信頼：50（標準）");
    });

    it("重要な記憶が入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).toContain("文化祭の準備を手伝った");
    });

    it("最近の会話が入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).toContain("こんにちは");
    });

    it("念押しの一文が入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).toContain(
        "以上を踏まえ、【思考手順】に沿って考え、【出力フォーマット】どおりセリフ本文のみを120文字以内で出力してください。"
      );
    });

    it("長期不在フラグが1のとき備考が入る", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput({ longTimeFlag: 1 }));

      expect(variable).toContain("【備考】");
      expect(variable).toContain("さみしさ");
    });

    it("長期不在フラグが0のとき備考が入らない", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput({ longTimeFlag: 0 }));

      expect(variable).not.toContain("【備考】");
    });

    it("日付の「/」がHTMLエスケープされていない（&#x2F;を含まない）", () => {
      const [, , variable] = buildDialogueGeneratorPromptLayers(baseInput());

      expect(variable).not.toContain("&#x2F;");
    });
  });

  describe("テンプレートに世界観・キャラクターに依存する語が直書きされていない", () => {
    const forbiddenWords = ["高校", "学校", "東京", "配信"];

    it.each([
      "conversation.fixed.mustache",
      "conversation.session.mustache",
      "conversation.variable.mustache",
    ])("%s", (fileName) => {
      const templatePath = fileURLToPath(
        new URL(`../../../src/dialogueGenerator/prompts/${fileName}`, import.meta.url)
      );
      const raw = readFileSync(templatePath, "utf8");

      for (const word of forbiddenWords) {
        expect(raw).not.toContain(word);
      }
    });
  });
});
