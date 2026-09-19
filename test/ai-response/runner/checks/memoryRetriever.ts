// -------------------------------------------------------
// memoryRetriever 向けのルールによる判定。
// runMemoryRetriever に戻り値は無く、保存は writes の characterMemory テーブルへの put
// （index が "state"・"absence-latest" 以外のもの）で見る。
// -------------------------------------------------------

import type { RunResult } from "../types.js";
import type { CharacterMemoryItem } from "../../../../src/types.js";
import type { CheckFn } from "./types.js";

const NON_MEMORY_INDEX_KEYS = new Set(["state", "absence-latest"]);

/** writes から、今回保存された重要記憶（感情状態・不在期間の記録は除く）を取り出す */
export function getSavedMemories(result: RunResult): CharacterMemoryItem[] {
  return result.writes
    .filter((w) => w.table === "characterMemory" && w.operation === "put")
    .map((w) => w.item as unknown as CharacterMemoryItem)
    .filter((item) => !NON_MEMORY_INDEX_KEYS.has(item.index));
}

function memoryText(item: CharacterMemoryItem): string {
  return `${item.eventSummary ?? ""} ${item.characterInterpretation ?? ""}`;
}

export const savedCount: CheckFn = (result, _context, params) => {
  const min = params?.min;
  const max = params?.max;
  if (min !== undefined && typeof min !== "number") {
    return { passed: false, detail: "params.min が不正（数値が必要）" };
  }
  if (max !== undefined && typeof max !== "number") {
    return { passed: false, detail: "params.max が不正（数値が必要）" };
  }
  if (min === undefined && max === undefined) {
    return { passed: false, detail: "params.min か params.max の少なくとも一方が必要" };
  }

  const count = getSavedMemories(result).length;
  const okMin = min === undefined || count >= min;
  const okMax = max === undefined || count <= max;
  const passed = okMin && okMax;
  return {
    passed,
    detail: passed
      ? undefined
      : `保存件数 ${count}（期待: min=${min ?? "指定なし"}, max=${max ?? "指定なし"}）`,
  };
};

export const savedMustMentionAny: CheckFn = (result, _context, params) => {
  const words = params?.words;
  if (!Array.isArray(words) || words.length === 0 || !words.every((w) => typeof w === "string")) {
    return { passed: false, detail: "params.words が不正（空でない文字列の配列が必要）" };
  }

  const saved = getSavedMemories(result);
  const passed = saved.some((m) => (words as string[]).some((w) => memoryText(m).includes(w)));
  return { passed, detail: passed ? undefined : `保存された記憶のどれにも含まれない: ${words.join(", ")}` };
};

export const savedMustNotMention: CheckFn = (result, _context, params) => {
  const words = params?.words;
  if (!Array.isArray(words) || words.length === 0 || !words.every((w) => typeof w === "string")) {
    return { passed: false, detail: "params.words が不正（空でない文字列の配列が必要）" };
  }

  const saved = getSavedMemories(result);
  const hits: string[] = [];
  for (const m of saved) {
    for (const w of words as string[]) {
      if (memoryText(m).includes(w)) {
        hits.push(`${m.index}: "${w}"`);
      }
    }
  }
  return { passed: hits.length === 0, detail: hits.length > 0 ? hits.join(", ") : undefined };
};
