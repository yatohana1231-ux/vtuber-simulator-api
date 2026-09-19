import { describe, it, expect } from "vitest";
import {
  parseEmotionUpdaterModelOutput,
  appraisalsToEmotionImpulses,
} from "../../../../src/lib/affect/appraisal.js";
import { DEFAULT_AFFECT_CONFIG, type AffectProfile } from "../../../../src/lib/affect/affectConfig.js";
import type { Appraisal, CharacterGoal } from "../../../../src/types.js";

// -------------------------------------------------------
// テスト用のヘルパー
// -------------------------------------------------------

const GOALS: CharacterGoal[] = [
  { key: "grow-as-streamer", description: "配信者として成長したい", importance: 80 },
  { key: "stay-healthy", description: "健康でいたい", importance: 30 },
];

/** AffectProfile のテスト用の値（personality.ts には依存しない） */
function profile(overrides: Partial<AffectProfile> = {}): AffectProfile {
  return {
    moodHomeBase: { pleasure: 0, arousal: 0, dominance: 0 },
    positiveEmotionGain: 1,
    negativeEmotionGain: 1,
    emotionHalfLifeScale: 1,
    moodHalfLifeScale: 1,
    lonelinessGrowthScale: 1,
    perceptionGainScale: 1,
    perceptionDampingSigma: 0.45,
    goals: GOALS,
    attachmentStyle: "secure",
    ...overrides,
  };
}

function appraisal(overrides: Partial<Appraisal> = {}): Appraisal {
  return {
    summary: "配信の声を褒められた",
    desirabilityForSelf: 0,
    desirabilityForPlayer: 0,
    prospect: "happened",
    cause: "player",
    praiseworthiness: 0,
    relatedGoalKey: null,
    ...overrides,
  };
}

// -------------------------------------------------------
// parseEmotionUpdaterModelOutput
// -------------------------------------------------------

describe("parseEmotionUpdaterModelOutput", () => {
  describe("正常な出力", () => {
    it("正常な appraisals と interaction → そのまま検証済みの値になる", () => {
      const raw = {
        appraisals: [
          {
            summary: "配信の声を褒められた",
            desirabilityForSelf: 2,
            desirabilityForPlayer: 0,
            prospect: "happened",
            cause: "player",
            praiseworthiness: 2,
            relatedGoalKey: "grow-as-streamer",
          },
        ],
        interaction: {
          playerSelfDisclosure: "fact",
          responseToCharacterDisclosure: "responsive",
          helpedCharacter: true,
          rememberedPastTopic: true,
        },
      };

      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);

      expect(result.appraisals).toEqual([
        {
          summary: "配信の声を褒められた",
          desirabilityForSelf: 2,
          desirabilityForPlayer: 0,
          prospect: "happened",
          cause: "player",
          praiseworthiness: 2,
          relatedGoalKey: "grow-as-streamer",
        },
      ]);
      expect(result.interaction).toEqual({
        playerSelfDisclosure: "fact",
        responseToCharacterDisclosure: "responsive",
        helpedCharacter: true,
        rememberedPastTopic: true,
      });
      expect(result.warnings).toEqual([]);
    });
  });

  describe("raw 自体が不正", () => {
    it("raw が null → appraisals は空", () => {
      const result = parseEmotionUpdaterModelOutput(null, GOALS, 1);
      expect(result.appraisals).toEqual([]);
    });

    it("raw が配列 → appraisals は空", () => {
      const result = parseEmotionUpdaterModelOutput([{ prospect: "happened" }], GOALS, 1);
      expect(result.appraisals).toEqual([]);
    });

    it("raw が文字列 → appraisals は空", () => {
      const result = parseEmotionUpdaterModelOutput("not json", GOALS, 1);
      expect(result.appraisals).toEqual([]);
    });

    it("raw.appraisals が配列でない（オブジェクト） → appraisals は空", () => {
      const result = parseEmotionUpdaterModelOutput({ appraisals: {} }, GOALS, 1);
      expect(result.appraisals).toEqual([]);
    });

    it("raw.appraisals が配列でない（文字列） → appraisals は空", () => {
      const result = parseEmotionUpdaterModelOutput({ appraisals: "happened" }, GOALS, 1);
      expect(result.appraisals).toEqual([]);
    });

    it("raw.appraisals が無い → appraisals は空（警告なし）", () => {
      const result = parseEmotionUpdaterModelOutput({}, GOALS, 1);
      expect(result.appraisals).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("appraisals の件数", () => {
    it("4件以上 → 先頭3件だけを使う", () => {
      const raw = {
        appraisals: [
          appraisal({ summary: "1件目" }),
          appraisal({ summary: "2件目" }),
          appraisal({ summary: "3件目" }),
          appraisal({ summary: "4件目" }),
        ],
      };

      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);

      expect(result.appraisals).toHaveLength(3);
      expect(result.appraisals.map((a) => a.summary)).toEqual(["1件目", "2件目", "3件目"]);
    });
  });

  describe("数値の項目（desirabilityForSelf・desirabilityForPlayer・praiseworthiness）", () => {
    it("小数 → 四捨五入される", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", desirabilityForSelf: 2.5 }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].desirabilityForSelf).toBe(3);
      expect(result.warnings).toEqual([]);
    });

    it("範囲外の数値 → -3〜+3 にクランプされる（警告なし）", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", desirabilityForSelf: 10, praiseworthiness: -10 }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].desirabilityForSelf).toBe(3);
      expect(result.appraisals[0].praiseworthiness).toBe(-3);
      expect(result.warnings).toEqual([]);
    });

    it("文字列 → 0 にして警告する", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", desirabilityForSelf: "2" }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].desirabilityForSelf).toBe(0);
      expect(result.warnings.some((w) => w.includes("desirabilityForSelf"))).toBe(true);
    });

    it("NaN → 0 にして警告する", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", desirabilityForSelf: NaN }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].desirabilityForSelf).toBe(0);
      expect(result.warnings.some((w) => w.includes("desirabilityForSelf"))).toBe(true);
    });

    it("項目の省略 → 警告なしで 0", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player" }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].desirabilityForSelf).toBe(0);
      expect(result.appraisals[0].desirabilityForPlayer).toBe(0);
      expect(result.appraisals[0].praiseworthiness).toBe(0);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("prospect・cause", () => {
    it("prospect が不正な値 → その評価を捨てて警告する", () => {
      const raw = { appraisals: [appraisal({ prospect: "unknown" as never })] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals).toEqual([]);
      expect(result.warnings.some((w) => w.includes("prospect"))).toBe(true);
    });

    it("cause が不正な値 → その評価を捨てて警告する", () => {
      const raw = { appraisals: [appraisal({ cause: "unknown" as never })] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals).toEqual([]);
      expect(result.warnings.some((w) => w.includes("cause"))).toBe(true);
    });

    it("複数件のうち1件だけ不正 → その1件だけ捨てられる", () => {
      const raw = {
        appraisals: [
          appraisal({ summary: "有効1" }),
          appraisal({ summary: "無効", prospect: "unknown" as never }),
          appraisal({ summary: "有効2" }),
        ],
      };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals.map((a) => a.summary)).toEqual(["有効1", "有効2"]);
    });
  });

  describe("summary", () => {
    it("文字列でない → 空文字になる", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", summary: 123 }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].summary).toBe("");
    });
  });

  describe("relatedGoalKey", () => {
    it("goals に無い未知の値 → null にして警告する", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", relatedGoalKey: "no-such-goal" }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].relatedGoalKey).toBeNull();
      expect(result.warnings.some((w) => w.includes("relatedGoalKey"))).toBe(true);
    });

    it("null → 警告なしで null のまま", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", relatedGoalKey: null }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].relatedGoalKey).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("省略 → 警告なしで null", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player" }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].relatedGoalKey).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it("goals にある値 → そのまま使う", () => {
      const raw = { appraisals: [{ prospect: "happened", cause: "player", relatedGoalKey: "stay-healthy" }] };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.appraisals[0].relatedGoalKey).toBe("stay-healthy");
    });
  });

  describe("interaction（process による分岐）", () => {
    it("process=1 → interaction は null（raw に interaction があっても無視される）", () => {
      const raw = {
        appraisals: [],
        interaction: {
          playerSelfDisclosure: "fact",
          responseToCharacterDisclosure: "responsive",
          helpedCharacter: true,
          rememberedPastTopic: true,
        },
      };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 1);
      expect(result.interaction).toBeNull();
    });

    it("process=2 で interaction が無い → 既定値になる（警告なし）", () => {
      const result = parseEmotionUpdaterModelOutput({ appraisals: [] }, GOALS, 2);
      expect(result.interaction).toEqual({
        playerSelfDisclosure: "none",
        responseToCharacterDisclosure: "not_applicable",
        helpedCharacter: false,
        rememberedPastTopic: false,
      });
      expect(result.warnings).toEqual([]);
    });

    it("process=2 で raw.interaction がオブジェクトでない → 既定値になる（警告なし）", () => {
      const result = parseEmotionUpdaterModelOutput({ appraisals: [], interaction: "none" }, GOALS, 2);
      expect(result.interaction).toEqual({
        playerSelfDisclosure: "none",
        responseToCharacterDisclosure: "not_applicable",
        helpedCharacter: false,
        rememberedPastTopic: false,
      });
      expect(result.warnings).toEqual([]);
    });

    it("playerSelfDisclosure が不正な値 → 既定値（none）にして警告する", () => {
      const raw = { appraisals: [], interaction: { playerSelfDisclosure: "everything" } };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);
      expect(result.interaction?.playerSelfDisclosure).toBe("none");
      expect(result.warnings.some((w) => w.includes("playerSelfDisclosure"))).toBe(true);
    });

    it("responseToCharacterDisclosure が不正な値 → 既定値（not_applicable）にして警告する", () => {
      const raw = { appraisals: [], interaction: { responseToCharacterDisclosure: 123 } };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);
      expect(result.interaction?.responseToCharacterDisclosure).toBe("not_applicable");
      expect(result.warnings.some((w) => w.includes("responseToCharacterDisclosure"))).toBe(true);
    });

    it("helpedCharacter が真偽値でない → 既定値（false）にして警告する", () => {
      const raw = { appraisals: [], interaction: { helpedCharacter: "yes" } };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);
      expect(result.interaction?.helpedCharacter).toBe(false);
      expect(result.warnings.some((w) => w.includes("helpedCharacter"))).toBe(true);
    });

    it("rememberedPastTopic が真偽値でない → 既定値（false）にして警告する", () => {
      const raw = { appraisals: [], interaction: { rememberedPastTopic: 1 } };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);
      expect(result.interaction?.rememberedPastTopic).toBe(false);
      expect(result.warnings.some((w) => w.includes("rememberedPastTopic"))).toBe(true);
    });

    it("項目の省略 → 警告なしで既定値", () => {
      const raw = { appraisals: [], interaction: { helpedCharacter: true } };
      const result = parseEmotionUpdaterModelOutput(raw, GOALS, 2);
      expect(result.interaction).toEqual({
        playerSelfDisclosure: "none",
        responseToCharacterDisclosure: "not_applicable",
        helpedCharacter: true,
        rememberedPastTopic: false,
      });
      expect(result.warnings).toEqual([]);
    });
  });
});

// -------------------------------------------------------
// appraisalsToEmotionImpulses
// -------------------------------------------------------

describe("appraisalsToEmotionImpulses", () => {
  describe("happened の正負", () => {
    it("prospect=happened, ds > 0 → joy が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: 2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["joy"]);
    });

    it("prospect=happened, ds < 0 → sadness が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: -2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["sadness"]);
    });
  });

  describe("anticipated の正負", () => {
    it("prospect=anticipated, ds > 0 → hope が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "anticipated", desirabilityForSelf: 1 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["hope"]);
    });

    it("prospect=anticipated, ds < 0 → anxiety が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "anticipated", desirabilityForSelf: -1 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["anxiety"]);
    });
  });

  describe("avoided・missed", () => {
    it("prospect=avoided → relief が出て、点数は max(|ds|,1)", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "avoided", desirabilityForSelf: -3 })],
        profile()
      );
      expect(impulses).toHaveLength(1);
      expect(impulses[0].emotion).toBe("relief");
      // ds=-3 → |ds|=3 なので intensityPerPoint(20) * 3 * (0.5+50/100) = 60
      expect(impulses[0].intensity).toBeCloseTo(20 * 3 * (0.5 + 50 / 100));
    });

    it("prospect=avoided かつ ds=0 → 点数は max(0,1)=1 として relief が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "avoided", desirabilityForSelf: 0 })],
        profile()
      );
      expect(impulses).toHaveLength(1);
      expect(impulses[0].emotion).toBe("relief");
      expect(impulses[0].intensity).toBeCloseTo(20 * 1 * (0.5 + 50 / 100));
    });

    it("prospect=missed → disappointment が出て、点数は max(|ds|,1)", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "missed", desirabilityForSelf: 2 })],
        profile()
      );
      expect(impulses).toHaveLength(1);
      expect(impulses[0].emotion).toBe("disappointment");
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * (0.5 + 50 / 100));
    });
  });

  describe("cause: self の pride・shame", () => {
    it("prospect=happened, cause=self, pw > 0 → pride が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "self", praiseworthiness: 2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["pride"]);
    });

    it("prospect=happened, cause=self, pw < 0 → shame が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "self", praiseworthiness: -2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["shame"]);
    });
  });

  describe("cause: player/other の admiration・gratitude・anger", () => {
    it("pw > 0 かつ ds <= 0 → admiration のみ（gratitude は出ない）", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "player", praiseworthiness: 2, desirabilityForSelf: 0 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["admiration"]);
    });

    it("pw > 0 かつ ds > 0 → admiration と gratitude の両方が出る（点数は |ds|。ds > 0 なので joy も別途出る）", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "player", praiseworthiness: 2, desirabilityForSelf: 3 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion).sort()).toEqual(["admiration", "gratitude", "joy"]);
      const gratitude = impulses.find((i) => i.emotion === "gratitude")!;
      expect(gratitude.intensity).toBeCloseTo(20 * 3 * (0.5 + 50 / 100));
    });

    it("cause=other でも admiration・gratitude が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "other", praiseworthiness: 1, desirabilityForSelf: 1 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toContain("admiration");
      expect(impulses.map((i) => i.emotion)).toContain("gratitude");
    });

    it("pw < 0 かつ ds >= 0 → anger の点数は |pw|（|ds| がより大きくても使われない）", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "player", praiseworthiness: -1, desirabilityForSelf: 3 })],
        profile()
      );
      const anger = impulses.find((i) => i.emotion === "anger")!;
      expect(anger.intensity).toBeCloseTo(20 * 1 * (0.5 + 50 / 100));
    });

    it("pw < 0 かつ ds < 0 → anger の点数は max(|pw|,|ds|)", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", cause: "player", praiseworthiness: -1, desirabilityForSelf: -3 })],
        profile()
      );
      const anger = impulses.find((i) => i.emotion === "anger")!;
      // max(1,3)=3
      expect(anger.intensity).toBeCloseTo(20 * 3 * (0.5 + 50 / 100));
    });
  });

  describe("cause: circumstance", () => {
    it("prospect=happened, cause=circumstance, pw があっても行いの情動が出ない", () => {
      const impulses = appraisalsToEmotionImpulses(
        [
          appraisal({
            prospect: "happened",
            cause: "circumstance",
            praiseworthiness: 3,
            desirabilityForSelf: 0,
            desirabilityForPlayer: 0,
          }),
        ],
        profile()
      );
      expect(impulses).toEqual([]);
    });
  });

  describe("prospect が happened でないとき", () => {
    it("prospect=anticipated で pw があっても行いの情動が出ない", () => {
      const impulses = appraisalsToEmotionImpulses(
        [
          appraisal({
            prospect: "anticipated",
            cause: "player",
            praiseworthiness: 3,
            desirabilityForSelf: 0,
            desirabilityForPlayer: 0,
          }),
        ],
        profile()
      );
      expect(impulses).toEqual([]);
    });
  });

  describe("dp の正負", () => {
    it("dp > 0 → happyFor が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForPlayer: 2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["happyFor"]);
    });

    it("dp < 0 → sympathy が出る", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForPlayer: -2 })],
        profile()
      );
      expect(impulses.map((i) => i.emotion)).toEqual(["sympathy"]);
    });
  });

  describe("強さの式", () => {
    it("重要度50（既定）のとき、係数は ×1（0.5+50/100=1）", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: 2, relatedGoalKey: null })],
        profile()
      );
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 1);
    });

    it("relatedGoalKey が目標にあるとき、その目標の importance を使う", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: 2, relatedGoalKey: "grow-as-streamer" })],
        profile()
      );
      // importance=80 → 0.5+80/100=1.3
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 1.3);
    });

    it("relatedGoalKey が無い（null） → defaultGoalImportance（50）を使う", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: 2, relatedGoalKey: null })],
        profile(),
        { ...DEFAULT_AFFECT_CONFIG, emotion: { ...DEFAULT_AFFECT_CONFIG.emotion, defaultGoalImportance: 20 } }
      );
      // importance=20 → 0.5+20/100=0.7
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 0.7);
    });

    it("positive の情動（joy）は positiveEmotionGain がかかる", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: 2 })],
        profile({ positiveEmotionGain: 2 })
      );
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 1 * 2);
    });

    it("negative の情動（sadness）は negativeEmotionGain がかかる", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForSelf: -2 })],
        profile({ negativeEmotionGain: 3 })
      );
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 1 * 3);
    });

    it("sympathy は positiveEmotionGain/negativeEmotionGain をかけず、gain は常に1", () => {
      const impulses = appraisalsToEmotionImpulses(
        [appraisal({ prospect: "happened", desirabilityForPlayer: -2 })],
        profile({ positiveEmotionGain: 5, negativeEmotionGain: 5 })
      );
      expect(impulses[0].emotion).toBe("sympathy");
      expect(impulses[0].intensity).toBeCloseTo(20 * 2 * 1 * 1);
    });
  });

  describe("cause・summary の引き継ぎ", () => {
    it("EmotionImpulse の cause・summary は、もとの評価のものになる", () => {
      const impulses = appraisalsToEmotionImpulses(
        [
          appraisal({
            prospect: "happened",
            cause: "other",
            desirabilityForSelf: 2,
            summary: "友達に励まされた",
          }),
        ],
        profile()
      );
      expect(impulses[0].cause).toBe("other");
      expect(impulses[0].summary).toBe("友達に励まされた");
    });

    it("同じ情動が複数の評価から出ても、まとめずに別々に返す", () => {
      const impulses = appraisalsToEmotionImpulses(
        [
          appraisal({ prospect: "happened", desirabilityForSelf: 1, summary: "1件目" }),
          appraisal({ prospect: "happened", desirabilityForSelf: 1, summary: "2件目" }),
        ],
        profile()
      );
      expect(impulses).toHaveLength(2);
      expect(impulses.every((i) => i.emotion === "joy")).toBe(true);
      expect(impulses.map((i) => i.summary)).toEqual(["1件目", "2件目"]);
    });
  });

  describe("何も起きない", () => {
    it("ds=0・pw=0・dp=0（prospect=happened） → 空", () => {
      const impulses = appraisalsToEmotionImpulses(
        [
          appraisal({
            prospect: "happened",
            desirabilityForSelf: 0,
            desirabilityForPlayer: 0,
            praiseworthiness: 0,
          }),
        ],
        profile()
      );
      expect(impulses).toEqual([]);
    });

    it("評価が0件 → 空", () => {
      expect(appraisalsToEmotionImpulses([], profile())).toEqual([]);
    });
  });
});
