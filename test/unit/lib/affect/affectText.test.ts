import { describe, it, expect } from "vitest";
import { formatAffectForPrompt, describeReunionBehavior } from "../../../../src/lib/affect/affectText.js";
import { DEFAULT_AFFECT_CONFIG } from "../../../../src/lib/affect/affectConfig.js";
import { EMOTION_KEYS } from "../../../../src/types.js";
import type { CharacterAffectState, Emotions, MoodPad } from "../../../../src/types.js";

// ---- テスト用のヘルパー ----

function emotions(overrides: Partial<Emotions> = {}): Emotions {
  const base = Object.fromEntries(EMOTION_KEYS.map((key) => [key, 0])) as Emotions;
  return { ...base, ...overrides };
}

function state(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: emotions(),
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    needs: { fatigue: 0, loneliness: 0 },
    perception: { trust: 50, affection: 50, respect: 50, fear: 10, dependence: 10, familiarity: 50 },
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

// 8象限をおおよそ同じ大きさ（moderate: 40〜75）で作る
function moodFor(signs: { p: 1 | -1; a: 1 | -1; d: 1 | -1 }): MoodPad {
  const magnitude = 30;
  return { pleasure: signs.p * magnitude, arousal: signs.a * magnitude, dominance: signs.d * magnitude };
}

describe("formatAffectForPrompt", () => {
  it("仕様書の例のとおりの形になること（気分→情動→欲求の順、値は四捨五入）", () => {
    const s = state({
      mood: moodFor({ p: 1, a: 1, d: 1 }), // exuberant, moderate
      emotions: emotions({ joy: 55.4, gratitude: 29.6 }),
      needs: { fatigue: 61.9, loneliness: 10.4 },
    });

    const result = formatAffectForPrompt(s);

    expect(result).toBe(
      [
        "・今の気分：まあまあ、はつらつとして前向き",
        "・いま強く感じていること：喜び 55（はっきり）、感謝 30（少し）",
        "・疲労：62（かなり）",
        "・孤独感：10（ほとんど感じない）",
      ].join("\n")
    );
  });

  describe("気分の8象限", () => {
    const cases: Array<{ name: string; signs: { p: 1 | -1; a: 1 | -1; d: 1 | -1 }; label: string }> = [
      { name: "exuberant", signs: { p: 1, a: 1, d: 1 }, label: "はつらつとして前向き" },
      { name: "bored", signs: { p: -1, a: -1, d: -1 }, label: "退屈で気が乗らない" },
      { name: "dependent", signs: { p: 1, a: 1, d: -1 }, label: "人に甘えたい・頼りたい" },
      { name: "disdainful", signs: { p: -1, a: -1, d: 1 }, label: "冷めていて素っ気ない" },
      { name: "relaxed", signs: { p: 1, a: -1, d: 1 }, label: "くつろいで落ち着いている" },
      { name: "anxious", signs: { p: -1, a: 1, d: -1 }, label: "不安で落ち着かない" },
      { name: "docile", signs: { p: 1, a: -1, d: -1 }, label: "おだやかで素直" },
      { name: "hostile", signs: { p: -1, a: 1, d: 1 }, label: "いらだっている" },
    ];

    for (const c of cases) {
      it(`${c.name} → 「${c.label}」と表示されること`, () => {
        const result = formatAffectForPrompt(state({ mood: moodFor(c.signs) }));
        expect(result.split("\n")[0]).toBe(`・今の気分：まあまあ、${c.label}`);
      });
    }
  });

  it("neutral（原点付近） → 「ふつう」と表示されること", () => {
    const result = formatAffectForPrompt(state({ mood: { pleasure: 0, arousal: 0, dominance: 0 } }));
    expect(result.split("\n")[0]).toBe("・今の気分：ふつう（特に偏りはない）");
  });

  describe("気分の強さの3段階", () => {
    it("slight（neutralRadius以上・moderate未満） → 「少し」", () => {
      const result = formatAffectForPrompt(state({ mood: { pleasure: 20, arousal: 0, dominance: 0 } }));
      expect(result.split("\n")[0]).toBe("・今の気分：少し、はつらつとして前向き");
    });

    it("moderate（moderate以上・strong未満） → 「まあまあ」", () => {
      const result = formatAffectForPrompt(state({ mood: { pleasure: 50, arousal: 0, dominance: 0 } }));
      expect(result.split("\n")[0]).toBe("・今の気分：まあまあ、はつらつとして前向き");
    });

    it("strong（strong以上） → 「とても」", () => {
      const result = formatAffectForPrompt(state({ mood: { pleasure: 90, arousal: 0, dominance: 0 } }));
      expect(result.split("\n")[0]).toBe("・今の気分：とても、はつらつとして前向き");
    });
  });

  describe("情動", () => {
    it("複数の活動中の情動が、強い順に「、」でつながれること", () => {
      const s = state({ emotions: emotions({ joy: 80, gratitude: 50, sadness: 20 }) });
      const result = formatAffectForPrompt(s);

      expect(result.split("\n")[1]).toBe(
        "・いま強く感じていること：喜び 80（強く）、感謝 50（はっきり）、悲しみ・落ち込み 20（少し）"
      );
    });

    it("活動中の情動が無ければ「特になし」", () => {
      const result = formatAffectForPrompt(state({ emotions: emotions() }));
      expect(result.split("\n")[1]).toBe("・いま強く感じていること：特になし");
    });

    it("activeThreshold未満の情動はプロンプトに含めない", () => {
      const threshold = DEFAULT_AFFECT_CONFIG.emotion.activeThreshold;
      const result = formatAffectForPrompt(state({ emotions: emotions({ anger: threshold - 1 }) }));
      expect(result.split("\n")[1]).toBe("・いま強く感じていること：特になし");
    });

    describe("強さのラベルの境目", () => {
      it("40未満 → 「少し」", () => {
        const result = formatAffectForPrompt(state({ emotions: emotions({ joy: 39.9 }) }));
        expect(result.split("\n")[1]).toBe("・いま強く感じていること：喜び 40（少し）");
      });

      it("40以上70未満 → 「はっきり」", () => {
        const result = formatAffectForPrompt(state({ emotions: emotions({ joy: 40 }) }));
        expect(result.split("\n")[1]).toBe("・いま強く感じていること：喜び 40（はっきり）");
      });

      it("69.9（70未満） → 「はっきり」", () => {
        const result = formatAffectForPrompt(state({ emotions: emotions({ joy: 69.9 }) }));
        expect(result.split("\n")[1]).toBe("・いま強く感じていること：喜び 70（はっきり）");
      });

      it("70以上 → 「強く」", () => {
        const result = formatAffectForPrompt(state({ emotions: emotions({ joy: 70 }) }));
        expect(result.split("\n")[1]).toBe("・いま強く感じていること：喜び 70（強く）");
      });
    });
  });

  describe("欲求のラベルの境目", () => {
    it("20以下 → 「ほとんど感じない」", () => {
      const result = formatAffectForPrompt(state({ needs: { fatigue: 20, loneliness: 0 } }));
      expect(result.split("\n")[2]).toBe("・疲労：20（ほとんど感じない）");
    });

    it("20より大きく40以下 → 「少し」", () => {
      const result = formatAffectForPrompt(state({ needs: { fatigue: 40, loneliness: 0 } }));
      expect(result.split("\n")[2]).toBe("・疲労：40（少し）");
    });

    it("40より大きく60以下 → 「そこそこ」", () => {
      const result = formatAffectForPrompt(state({ needs: { fatigue: 60, loneliness: 0 } }));
      expect(result.split("\n")[2]).toBe("・疲労：60（そこそこ）");
    });

    it("60より大きく80以下 → 「かなり」", () => {
      const result = formatAffectForPrompt(state({ needs: { fatigue: 80, loneliness: 0 } }));
      expect(result.split("\n")[2]).toBe("・疲労：80（かなり）");
    });

    it("80より大きい → 「とても強い」", () => {
      const result = formatAffectForPrompt(state({ needs: { fatigue: 80.1, loneliness: 0 } }));
      expect(result.split("\n")[2]).toBe("・疲労：80（とても強い）"); // 表示は四捨五入で80、ラベルは元の値(80.1)基準
    });
  });

  it("疲労・孤独感の順に並ぶこと", () => {
    const result = formatAffectForPrompt(state({ needs: { fatigue: 30, loneliness: 70 } }));
    const lines = result.split("\n");
    expect(lines[2]).toBe("・疲労：30（少し）");
    expect(lines[3]).toBe("・孤独感：70（かなり）");
  });

  it("値を四捨五入して整数で表示すること", () => {
    const result = formatAffectForPrompt(
      state({
        needs: { fatigue: 33.5, loneliness: 33.4 },
      })
    );
    const lines = result.split("\n");
    expect(lines[2]).toBe("・疲労：34（少し）"); // 33.5 → 34（四捨五入）
    expect(lines[3]).toBe("・孤独感：33（少し）"); // 33.4 → 33
  });
});

describe("describeReunionBehavior", () => {
  it("secure → 素直に喜び、さみしさも自然に伝える説明", () => {
    expect(describeReunionBehavior("secure")).toBe(
      "久しぶりに会えたことを素直に喜び、さみしかった気持ちも自然に伝える。"
    );
  });

  it("anxious → 不安・さみしさが強く出る説明", () => {
    expect(describeReunionBehavior("anxious")).toBe(
      "会えなかった間の不安やさみしさが強く出る。少し拗ねたり、また来てくれるかを確かめたくなったりする。"
    );
  });

  it("avoidant → 素直に言えないが、うれしさがにじむ説明", () => {
    expect(describeReunionBehavior("avoidant")).toBe(
      "さみしかったことを素直に言えず、平気なふりをする。ただし、言葉の端々に会えてうれしい気持ちがにじむ。"
    );
  });
});
