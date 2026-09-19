import { describe, expect, it } from "vitest";
import { classifySentenceStyle, isCasualSentence, isPoliteSentence } from "./text.js";

describe("isPoliteSentence", () => {
  it("passes for the basic POLITE_ENDINGS forms", () => {
    expect(isPoliteSentence("今日は配信です。")).toBe(true);
    expect(isPoliteSentence("配信しました。")).toBe(true);
    expect(isPoliteSentence("行きません。")).toBe(true);
    expect(isPoliteSentence("頑張りましょう。")).toBe(true);
  });

  it("passes for '〜ございます' (matches the '〜ます' ending)", () => {
    expect(isPoliteSentence("ありがとうございます。")).toBe(true);
  });

  it("passes when a polite ending is followed by 'ね'/'よ'/'よね'", () => {
    expect(isPoliteSentence("そうなんですね")).toBe(true);
    expect(isPoliteSentence("行きますよ")).toBe(true);
    expect(isPoliteSentence("そうですよね")).toBe(true);
  });

  it("fails for a casual sentence", () => {
    expect(isPoliteSentence("今日は配信だよ。")).toBe(false);
  });

  it("fails for a greeting with no polite/casual ending", () => {
    expect(isPoliteSentence("はじめまして")).toBe(false);
  });
});

describe("isCasualSentence", () => {
  it("passes for representative casual endings", () => {
    for (const s of ["今日は配信だよ", "行くね", "楽しみだね", "そうだよね", "帰るじゃん", "できるかな", "眠いかも"]) {
      expect(isCasualSentence(s)).toBe(true);
    }
  });

  it("fails for a polite sentence even when it ends with 'ね'/'よ' (polite is checked first)", () => {
    expect(isCasualSentence("そうなんですね")).toBe(false);
    expect(isCasualSentence("行きますよ")).toBe(false);
  });

  it("fails for a greeting with no casual ending", () => {
    expect(isCasualSentence("はじめまして")).toBe(false);
  });

  it("fails for an empty core (sentence is only punctuation)", () => {
    expect(isCasualSentence("！")).toBe(false);
  });
});

describe("classifySentenceStyle", () => {
  it("classifies a polite sentence as 'polite'", () => {
    expect(classifySentenceStyle("よろしくお願いします。")).toBe("polite");
  });

  it("classifies a casual sentence as 'casual'", () => {
    expect(classifySentenceStyle("よろしくね。")).toBe("casual");
  });

  it("classifies a fixed greeting as 'neutral' (neither polite nor casual)", () => {
    expect(classifySentenceStyle("はじめまして")).toBe("neutral");
    expect(classifySentenceStyle("こんにちは")).toBe("neutral");
  });

  // 「うれしい」は形容詞の言い切り（体言止めに近い一段落ち）で、POLITE_ENDINGS にも
  // CASUAL_ENDINGS にも当たらないため neutral 扱いになる。文体判定の対象外としており、
  // politenessStyle の合否には影響しない（期待と逆の分類として数えられない）。
  it("classifies an emotional exclamation ('うれしい') as 'neutral'", () => {
    expect(classifySentenceStyle("うれしい…！")).toBe("neutral");
  });
});
