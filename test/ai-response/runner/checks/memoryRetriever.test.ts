import { describe, expect, it } from "vitest";
import { getSavedMemories, savedCount, savedMustMentionAny, savedMustNotMention } from "./memoryRetriever.js";
import { makeContext, makeRunResult } from "./fixtures.js";
import type { CharacterMemoryItem } from "../../../../src/types.js";

// DynamoWriteRecord.item は Record<string, unknown> 型。CharacterMemoryItem（interface）は
// 明示のインデックスシグネチャが無いため直接は代入できず、unknown を経由してキャストする。
function memoryItem(overrides: Partial<CharacterMemoryItem> = {}): Record<string, unknown> {
  const item: CharacterMemoryItem = {
    memory_id: "character-1",
    index: "2026-09-19T00:00:00.000Z_abcd1234",
    eventSummary: "プレイヤーと今度の週末に遊ぶ約束をした",
    characterInterpretation: "楽しみにしている",
    tags: ["約束"],
    importance: 60,
    memoryType: "promise",
    ...overrides,
  };
  return item as unknown as Record<string, unknown>;
}

describe("getSavedMemories", () => {
  it("excludes state/absence-latest writes and non-put/non-characterMemory writes", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [
        { table: "characterMemory", operation: "put", item: memoryItem() },
        { table: "characterMemory", operation: "put", item: { memory_id: "c1", index: "state" } },
        { table: "characterMemory", operation: "put", item: { memory_id: "c1", index: "absence-latest" } },
        { table: "conversationLogs", operation: "put", item: { conversation_id: "c1" } },
        { table: "characterMemory", operation: "update", item: { memory_id: "c1", index: "not-put" } },
      ],
    });
    expect(getSavedMemories(result)).toHaveLength(1);
  });
});

describe("savedCount", () => {
  it("passes within min/max", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [{ table: "characterMemory", operation: "put", item: memoryItem() }],
    });
    expect(savedCount(result, makeContext(), { min: 1, max: 2 }).passed).toBe(true);
  });

  it("fails below min", () => {
    const result = makeRunResult({ function: "memoryRetriever", writes: [] });
    expect(savedCount(result, makeContext(), { min: 1 }).passed).toBe(false);
  });

  it("fails above max", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [
        { table: "characterMemory", operation: "put", item: memoryItem({ index: "i1" }) },
        { table: "characterMemory", operation: "put", item: memoryItem({ index: "i2" }) },
      ],
    });
    expect(savedCount(result, makeContext(), { max: 1 }).passed).toBe(false);
  });

  it("fails when neither min nor max is given", () => {
    const result = makeRunResult({ function: "memoryRetriever", writes: [] });
    expect(savedCount(result, makeContext(), {}).passed).toBe(false);
  });
});

describe("savedMustMentionAny", () => {
  it("passes when a saved memory mentions one of the words", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [{ table: "characterMemory", operation: "put", item: memoryItem() }],
    });
    expect(savedMustMentionAny(result, makeContext(), { words: ["約束", "誕生日"] }).passed).toBe(true);
  });

  it("fails when no saved memory mentions any of the words", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [{ table: "characterMemory", operation: "put", item: memoryItem() }],
    });
    expect(savedMustMentionAny(result, makeContext(), { words: ["誕生日"] }).passed).toBe(false);
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({ function: "memoryRetriever", writes: [] });
    expect(savedMustMentionAny(result, makeContext(), { words: [] }).passed).toBe(false);
  });
});

describe("savedMustNotMention", () => {
  it("passes when no saved memory mentions the words", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [{ table: "characterMemory", operation: "put", item: memoryItem() }],
    });
    expect(savedMustNotMention(result, makeContext(), { words: ["雑談"] }).passed).toBe(true);
  });

  it("fails when a saved memory mentions a forbidden word", () => {
    const result = makeRunResult({
      function: "memoryRetriever",
      writes: [{ table: "characterMemory", operation: "put", item: memoryItem() }],
    });
    const outcome = savedMustNotMention(result, makeContext(), { words: ["約束"] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("約束");
  });
});
