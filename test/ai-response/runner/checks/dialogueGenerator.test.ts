import { describe, expect, it } from "vitest";
import {
  maxLength,
  mustMentionAny,
  mustNotMention,
  noAiDisclosure,
  noForbiddenElements,
  politenessStyle,
} from "./dialogueGenerator.js";
import { makeContext, makeRunResult, makeWorld } from "./fixtures.js";

describe("maxLength", () => {
  it("passes when within the default limit (120)", () => {
    const result = makeRunResult({ output: "こんにちは" });
    expect(maxLength(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when longer than the default limit", () => {
    const result = makeRunResult({ output: "あ".repeat(121) });
    const outcome = maxLength(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("121");
  });

  it("respects params.max", () => {
    const result = makeRunResult({ output: "12345" });
    expect(maxLength(result, makeContext(), { max: 4 }).passed).toBe(false);
    expect(maxLength(result, makeContext(), { max: 5 }).passed).toBe(true);
  });

  it("fails when output is not a string", () => {
    const result = makeRunResult({ output: { reply: "not a string output" } });
    expect(maxLength(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("noForbiddenElements", () => {
  it("passes when none of the forbidden elements appear", () => {
    const context = makeContext({ world: makeWorld({ forbiddenElements: ["暴力"] }) });
    const result = makeRunResult({ output: "今日はいい天気だね" });
    expect(noForbiddenElements(result, context, undefined).passed).toBe(true);
  });

  it("fails when a forbidden element appears", () => {
    const context = makeContext({ world: makeWorld({ forbiddenElements: ["暴力"] }) });
    const result = makeRunResult({ output: "それは暴力だよ" });
    const outcome = noForbiddenElements(result, context, undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("暴力");
  });
});

describe("noAiDisclosure", () => {
  it("passes for an ordinary reply", () => {
    const result = makeRunResult({ output: "今日は配信だよ！楽しみだね" });
    expect(noAiDisclosure(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when disclosing being an AI", () => {
    const result = makeRunResult({ output: "私はAIだから正確な情報を教えるね" });
    expect(noAiDisclosure(result, makeContext(), undefined).passed).toBe(false);
  });

  it("fails case-insensitively", () => {
    const result = makeRunResult({ output: "I am an ai assistant" });
    expect(noAiDisclosure(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("mustMentionAny / mustNotMention", () => {
  it("mustMentionAny passes when one of the words appears", () => {
    const result = makeRunResult({ output: "今日は学校だったよ" });
    expect(mustMentionAny(result, makeContext(), { words: ["学校", "配信"] }).passed).toBe(true);
  });

  it("mustMentionAny fails when none appear", () => {
    const result = makeRunResult({ output: "今日はゲームしてた" });
    expect(mustMentionAny(result, makeContext(), { words: ["学校", "配信"] }).passed).toBe(false);
  });

  it("mustMentionAny fails for invalid params", () => {
    const result = makeRunResult({ output: "今日は学校だったよ" });
    expect(mustMentionAny(result, makeContext(), { words: [] }).passed).toBe(false);
    expect(mustMentionAny(result, makeContext(), {}).passed).toBe(false);
  });

  it("mustNotMention passes when none appear", () => {
    const result = makeRunResult({ output: "今日はゲームしてた" });
    expect(mustNotMention(result, makeContext(), { words: ["学校"] }).passed).toBe(true);
  });

  it("mustNotMention fails when one appears", () => {
    const result = makeRunResult({ output: "今日は学校だったよ" });
    const outcome = mustNotMention(result, makeContext(), { words: ["学校"] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("学校");
  });
});

describe("politenessStyle", () => {
  it("passes casual for a casual reply", () => {
    const result = makeRunResult({ output: "ありがとう！今日は配信だよ。" });
    expect(politenessStyle(result, makeContext(), { expect: "casual" }).passed).toBe(true);
  });

  it("fails casual for a polite reply", () => {
    const result = makeRunResult({ output: "ありがとうございます！配信だよ。" });
    const outcome = politenessStyle(result, makeContext(), { expect: "casual" });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("ありがとうございます");
  });

  it("passes polite for a fully polite reply", () => {
    const result = makeRunResult({ output: "ありがとうございます。今日は配信でした。" });
    expect(politenessStyle(result, makeContext(), { expect: "polite" }).passed).toBe(true);
  });

  it("fails polite when a casual sentence is mixed in", () => {
    const result = makeRunResult({ output: "ありがとうございます。今日は配信だよ。" });
    const outcome = politenessStyle(result, makeContext(), { expect: "polite" });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("配信だよ");
  });

  it("fails for invalid params.expect", () => {
    const result = makeRunResult({ output: "ありがとう！" });
    expect(politenessStyle(result, makeContext(), { expect: "friendly" }).passed).toBe(false);
  });

  it("passes polite for a fixed greeting followed by a polite sentence", () => {
    const result = makeRunResult({ output: "はじめまして！よろしくお願いします。" });
    expect(politenessStyle(result, makeContext(), { expect: "polite" }).passed).toBe(true);
  });

  it("fails polite for a fixed greeting followed by a casual sentence", () => {
    const result = makeRunResult({ output: "はじめまして！よろしくね。" });
    const outcome = politenessStyle(result, makeContext(), { expect: "polite" });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("よろしくね");
  });

  it("passes polite for '〜ですね' (a polite ending followed by the sentence-final 'ね')", () => {
    const result = makeRunResult({ output: "そうなんですね！" });
    expect(politenessStyle(result, makeContext(), { expect: "polite" }).passed).toBe(true);
  });

  // 「えっ、ほんとに！？うれしい…！」はどの文も丁寧語・常体いずれの語尾にも当たらず
  // neutral になる（「うれしい」は形容詞の言い切りで、text.test.ts の classifySentenceStyle
  // のテストで neutral であることを直接確かめている）。neutral な文はどちらの期待でも
  // 数えないため、polite・casual のどちらの期待でも合格する。
  it("passes both polite and casual for an exclamation with no polite/casual sentence-ending ('えっ、ほんとに！？うれしい…！')", () => {
    const result = makeRunResult({ output: "えっ、ほんとに！？うれしい…！" });
    expect(politenessStyle(result, makeContext(), { expect: "polite" }).passed).toBe(true);
    expect(politenessStyle(result, makeContext(), { expect: "casual" }).passed).toBe(true);
  });
});
