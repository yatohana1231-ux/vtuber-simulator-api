// -------------------------------------------------------
// ルールによる判定で使う、文字列に関する共通処理。
//
// 特定の世界観・キャラクターに依存する語はここに書かない（語はシナリオの params 経由）。
// -------------------------------------------------------

/** 文字列を文字 bigram の集合にする。長さ1以下の文字列は、空でなければ文字列そのものを1件の要素にする */
function toBigramSet(value: string): Set<string> {
  const s = value.trim();
  if (s.length < 2) {
    return new Set(s.length > 0 ? [s] : []);
  }
  const grams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    grams.add(s.slice(i, i + 2));
  }
  return grams;
}

/**
 * 文字 bigram の Jaccard 係数（0〜1）で2つの文字列の類似度を測る、簡易な指標。
 * 意味は見ず、表記の重なりだけを見るヒューリスティック（同じ出来事の言い換えでも
 * 表記が大きく異なれば類似度は低く出る）。
 */
export function bigramJaccardSimilarity(a: string, b: string): number {
  const setA = toBigramSet(a);
  const setB = toBigramSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type JsonExtractResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/**
 * モデルの応答テキストから JSON を取り出す。src/lib/bedrock.ts の invokeModelJson と
 * 同じ抽出方法（```json フェンス優先、無ければ裸の { ... }）に揃えている。
 * 抽出・パース方法を変えたら、あちらとここの両方を直すこと。
 */
export function extractJsonFromText(raw: string): JsonExtractResult {
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    return { ok: false, reason: "応答テキストから JSON ブロックが見つからない" };
  }
  try {
    return { ok: true, value: JSON.parse(jsonMatch[1].trim()) };
  } catch (e) {
    return { ok: false, reason: `JSON のパースに失敗: ${(e as Error).message}` };
  }
}

const SENTENCE_END_CHARS = "。！？♪";

/**
 * テキストを「文」に分割する。文末記号（。！？♪）の直後、または改行の直前で区切る
 * （記号・改行はどちらも捨てる）。末尾に文末記号が無い残りも1文として扱う。
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const parts: string[] = [];
  let buf = "";
  for (const ch of normalized) {
    if (ch === "\n") {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
    if (SENTENCE_END_CHARS.includes(ch)) {
      parts.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter((s) => s.length > 0);
}

const POLITE_ENDINGS = ["でした", "ました", "ません", "ましょう", "でしょう", "ください", "です", "ます"];

/**
 * 文が丁寧語（です・ます調）で終わっているかを見る、簡易なヒューリスティック。
 * 文末記号を外した末尾が、丁寧語の代表的な語尾で終わるかどうかだけを見ており、
 * 「あります」「頑張ります」のような丁寧語の一部が名詞化した表現など、
 * 誤判定しうるケースがあることに注意。
 */
export function isPoliteSentence(sentence: string): boolean {
  const core = sentence.replace(/[。！？♪]+$/u, "").trim();
  return POLITE_ENDINGS.some((ending) => core.endsWith(ending));
}
