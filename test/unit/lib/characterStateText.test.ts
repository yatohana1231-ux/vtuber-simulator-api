import { describe, it, expect } from "vitest";
import { formatPerceptionForPrompt } from "../../../src/lib/characterStateText.js";
import type { Perception } from "../../../src/types.js";

function basePerception(overrides: Partial<Perception> = {}): Perception {
  return {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 50,
    dependence: 50,
    familiarity: 50,
    ...overrides,
  };
}

describe("formatPerceptionForPrompt", () => {
  it("6項目を Object.entries の順（trust, affection, respect, fear, dependence, familiarity）で改行区切りにする", () => {
    const text = formatPerceptionForPrompt(basePerception());

    expect(text.split("\n")).toEqual([
      "・信頼：50（標準）",
      "・好感：50（標準）",
      "・尊敬：50（標準）",
      "・恐れ：50（標準）",
      "・依存：50（標準）",
      "・親しみ：50（標準）",
    ]);
  });

  it("書式は「・ラベル：値（段階のラベル）」になる", () => {
    const text = formatPerceptionForPrompt(basePerception({ trust: 35 }));

    expect(text).toContain("・信頼：35（低い）");
  });

  describe("段階のラベルの境界値", () => {
    it("20 → ほとんど感じない", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 20 }))).toContain(
        "・信頼：20（ほとんど感じない）"
      );
    });

    it("21 → 低い", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 21 }))).toContain("・信頼：21（低い）");
    });

    it("40 → 低い", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 40 }))).toContain("・信頼：40（低い）");
    });

    it("41 → 標準", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 41 }))).toContain("・信頼：41（標準）");
    });

    it("60 → 標準", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 60 }))).toContain("・信頼：60（標準）");
    });

    it("61 → 自覚している", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 61 }))).toContain(
        "・信頼：61（自覚している）"
      );
    });

    it("80 → 自覚している", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 80 }))).toContain(
        "・信頼：80（自覚している）"
      );
    });

    it("81 → 強く感じる", () => {
      expect(formatPerceptionForPrompt(basePerception({ trust: 81 }))).toContain("・信頼：81（強く感じる）");
    });
  });
});
