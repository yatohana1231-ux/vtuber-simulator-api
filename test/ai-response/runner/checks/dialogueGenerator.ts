// -------------------------------------------------------
// dialogueGenerator 向けのルールによる判定。
// runDialogueGenerator は reply の文字列をそのまま返す（result.output は string）。
// -------------------------------------------------------

import type { CheckFn, CheckOutcome } from "./types.js";
import { isPoliteSentence, splitSentences } from "./text.js";

const DEFAULT_MAX_LENGTH = 120;

// 「AI であることの開示」とみなす語。大文字小文字は無視する。特定の世界観・キャラクターに
// 依存しない、一般的な語だけを置く。
const AI_DISCLOSURE_WORDS = ["ai", "人工知能", "言語モデル", "アシスタント", "llm", "チャットボット"];

function getReplyText(output: unknown): { ok: true; reply: string } | { ok: false; outcome: CheckOutcome } {
  if (typeof output !== "string") {
    return {
      ok: false,
      outcome: { passed: false, detail: "output が文字列ではない（dialogueGenerator 用の判定）" },
    };
  }
  return { ok: true, reply: output };
}

export const maxLength: CheckFn = (result, _context, params) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const max = typeof params?.max === "number" ? params.max : DEFAULT_MAX_LENGTH;
  const length = Array.from(reply.reply).length;
  const passed = length <= max;
  return { passed, detail: passed ? undefined : `文字数 ${length} が上限 ${max} を超えている` };
};

export const noForbiddenElements: CheckFn = (result, context) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const hits = (context.world.forbiddenElements ?? []).filter(
    (word) => word && reply.reply.includes(word)
  );
  return {
    passed: hits.length === 0,
    detail: hits.length > 0 ? `禁止要素を含む: ${hits.join(", ")}` : undefined,
  };
};

export const noAiDisclosure: CheckFn = (result) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const lower = reply.reply.toLowerCase();
  // 英字の語（ai・llm）は部分一致だと "mail" や "daily" にも当たるので、前後が英字でないときだけ数える
  const hits = AI_DISCLOSURE_WORDS.filter((word) =>
    /^[a-z]+$/.test(word) ? new RegExp(`(?<![a-z])${word}(?![a-z])`).test(lower) : lower.includes(word)
  );
  return {
    passed: hits.length === 0,
    detail: hits.length > 0 ? `AI であることの開示とみなせる語を含む: ${hits.join(", ")}` : undefined,
  };
};

function readWords(params: Record<string, unknown> | undefined): string[] | null {
  const words = params?.words;
  if (!Array.isArray(words) || words.length === 0 || !words.every((w) => typeof w === "string")) {
    return null;
  }
  return words as string[];
}

export const mustMentionAny: CheckFn = (result, _context, params) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const words = readWords(params);
  if (!words) return { passed: false, detail: "params.words が不正（空でない文字列の配列が必要）" };

  const passed = words.some((w) => reply.reply.includes(w));
  return { passed, detail: passed ? undefined : `いずれも含まれない: ${words.join(", ")}` };
};

export const mustNotMention: CheckFn = (result, _context, params) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const words = readWords(params);
  if (!words) return { passed: false, detail: "params.words が不正（空でない文字列の配列が必要）" };

  const hits = words.filter((w) => reply.reply.includes(w));
  return { passed: hits.length === 0, detail: hits.length > 0 ? `含まれてはいけない語: ${hits.join(", ")}` : undefined };
};

/**
 * 文末の表現から丁寧語（です・ます調）と常体（だ・である調）の混在を見る、簡易な判定
 * （ヒューリスティック）。文の切り出し・丁寧語の判定はどちらも簡易なもの
 * （text.ts の splitSentences / isPoliteSentence を参照）で、皮肉・引用・キャラクターの
 * 口癖などを丁寧語と誤判定する可能性がある。
 */
export const politenessStyle: CheckFn = (result, _context, params) => {
  const reply = getReplyText(result.output);
  if (!reply.ok) return reply.outcome;

  const expect = params?.expect;
  if (expect !== "casual" && expect !== "polite") {
    return { passed: false, detail: `params.expect が不正: ${String(expect)}` };
  }

  const sentences = splitSentences(reply.reply);
  const polite = sentences.filter(isPoliteSentence);
  const casual = sentences.filter((s) => !isPoliteSentence(s));

  if (expect === "casual") {
    const passed = polite.length === 0;
    return { passed, detail: passed ? undefined : `丁寧語の文: ${polite.join(" / ")}` };
  }
  const passed = casual.length === 0;
  return { passed, detail: passed ? undefined : `丁寧語でない文: ${casual.join(" / ")}` };
};
