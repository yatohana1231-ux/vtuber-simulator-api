import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeAll } from "vitest";

import { buildAbsenceSimulatorPromptLayers } from "../../../src/absenceSimulator/prompt.js";
import { loadPackage } from "../../../src/lib/packages.js";
import type {
  AbsenceSimulatorPromptInput,
} from "../../../src/absenceSimulator/prompt.js";
import type {
  AbsenceSkeleton,
  AbsenceThread,
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

function skeleton(overrides: Partial<AbsenceSkeleton> = {}): AbsenceSkeleton {
  return {
    startDatetime: "2026-09-17T22:00:00.000Z", // 2026/09/18(金) 07:00 JST
    endDatetime: "2026-09-18T10:00:00.000Z", // 2026/09/18(金) 19:00 JST
    actionSlots: [
      { startDatetime: "2026-09-17T22:00:00.000Z", endDatetime: "2026-09-17T22:30:00.000Z", activity: "起床・身支度" },
      { startDatetime: "2026-09-17T22:30:00.000Z", endDatetime: "2026-09-18T06:30:00.000Z", activity: "学校の授業" },
    ],
    eventKinds: [
      { key: "daily", label: "日常のひとコマ", weight: 4 },
      { key: "small-joy", label: "ちょっと嬉しいこと", weight: 2 },
    ],
    ...overrides,
  };
}

function openThread(overrides: Partial<AbsenceThread> = {}): AbsenceThread {
  return {
    id: "thread-1",
    topic: "来週テストがある",
    status: "open",
    openedAt: "2026-09-15T10:00:00.000Z",
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

function baseInput(overrides: Partial<AbsenceSimulatorPromptInput> = {}): AbsenceSimulatorPromptInput {
  return {
    world,
    character,
    skeleton: skeleton(),
    openThreads: [openThread()],
    recentEventSummaries: ["朝から雨が降っていた"],
    memories: [memory()],
    ...overrides,
  };
}

describe("buildAbsenceSimulatorPromptLayers", () => {
  it("層ごとの文字列の配列を [固定部, 可変部] の2要素で返す", () => {
    const layers = buildAbsenceSimulatorPromptLayers(baseInput());

    expect(layers).toHaveLength(2);
    expect(typeof layers[0]).toBe("string");
    expect(typeof layers[1]).toBe("string");
  });

  describe("固定部（① プロンプトキャッシュのための性質）", () => {
    it("骨格・日時・話題・記憶が違う2つの入力で、固定部は完全に同じ文字列になる", () => {
      const [fixedA] = buildAbsenceSimulatorPromptLayers(baseInput());
      const [fixedB] = buildAbsenceSimulatorPromptLayers(
        baseInput({
          skeleton: skeleton({
            startDatetime: "2026-08-01T00:00:00.000Z",
            endDatetime: "2026-08-03T00:00:00.000Z",
            actionSlots: [],
            eventKinds: [{ key: "discovery", label: "新しい発見や、はじめての体験", weight: 1 }],
          }),
          openThreads: [],
          recentEventSummaries: [],
          memories: [],
        })
      );

      expect(fixedA).toBe(fixedB);
    });

    it("キャラクター名・世界観の説明・出力フォーマットが入る", () => {
      const [fixed] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(fixed).toContain(character.name);
      expect(fixed).toContain(world.description);
      expect(fixed).toContain("threadUpdates");
      expect(fixed).toContain("newThreads");
      expect(fixed).toContain("events");
      expect(fixed).toContain("actions");
    });

    it("日時の表記が入らない（YYYY/MM/DD(曜) 形式が含まれない）", () => {
      const [fixed] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(fixed).not.toMatch(/\d{4}\/\d{2}\/\d{2}\([日月火水木金土]\)/);
    });
  });

  describe("可変部（③ 毎回変わる入力）", () => {
    it("行動の枠が、番号・現地時刻・活動の内容で入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).toContain("1. 2026/09/18(金) 07:00〜2026/09/18(金) 07:30 起床・身支度");
      expect(variable).toContain("2. 2026/09/18(金) 07:30〜2026/09/18(金) 15:30 学校の授業");
    });

    it("行動の枠が無い → 「（なし）」", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(
        baseInput({ skeleton: skeleton({ actionSlots: [] }) })
      );

      expect(variable).toContain("【行動の枠】\n（なし）");
    });

    it("出来事の種類が、この順番・ラベル・key で入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).toContain("1. 日常のひとコマ（kind: daily）");
      expect(variable).toContain("2. ちょっと嬉しいこと（kind: small-joy）");
    });

    it("続いている話題の id と topic が入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).toContain("[id: thread-1]");
      expect(variable).toContain("来週テストがある");
      expect(variable).toContain("2026/09/15(火) 19:00");
    });

    it("続いている話題が無い → 「（なし）」", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput({ openThreads: [] }));

      expect(variable).toContain("【続いている話題】\n（なし）");
    });

    it("最近の出来事が入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).toContain("・朝から雨が降っていた");
    });

    it("最近の出来事が無い → 「（なし）」", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput({ recentEventSummaries: [] }));

      expect(variable).toContain("【最近の出来事（繰り返さない）】\n（なし）");
    });

    it("重要な記憶が入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).toContain("・文化祭の準備を手伝った（楽しかった）");
    });

    it("重要な記憶が無い → 「（なし）」", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput({ memories: [] }));

      expect(variable).toContain("【重要な記憶】\n（なし）");
    });

    it("日付の「/」がHTMLエスケープされていない（&#x2F;を含まない）", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).not.toContain("&#x2F;");
    });

    it("affectTextを渡すと「不在に入ったときの気分」の節と文章が入る", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(
        baseInput({ affectText: "・今の気分：とても、はつらつとして前向き" })
      );

      expect(variable).toContain("【不在に入ったときの気分】");
      expect(variable).toContain("・今の気分：とても、はつらつとして前向き");
    });

    it("affectTextを渡さないと「不在に入ったときの気分」の節が出ない", () => {
      const [, variable] = buildAbsenceSimulatorPromptLayers(baseInput());

      expect(variable).not.toContain("【不在に入ったときの気分】");
    });
  });

  describe("テンプレートに世界観・キャラクターに依存する語が直書きされていない", () => {
    const forbiddenWords = ["高校", "学校", "東京", "配信"];

    it.each(["absenceSimulator.fixed.mustache", "absenceSimulator.variable.mustache"])(
      "%s",
      (fileName) => {
        const templatePath = fileURLToPath(
          new URL(`../../../src/absenceSimulator/prompts/${fileName}`, import.meta.url)
        );
        const raw = readFileSync(templatePath, "utf8");

        for (const word of forbiddenWords) {
          expect(raw).not.toContain(word);
        }
      }
    );
  });
});
