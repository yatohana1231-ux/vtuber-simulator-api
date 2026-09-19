// -------------------------------------------------------
// perception（関係値）を LLM プロンプト用の文章にする
//
// dialogueGenerator・emotionUpdater の2機能が、現在の perception を
// プロンプトに載せるための共通処理（A-9）。各項目を「・ラベル：値（段階のラベル）」の
// 形にして改行でつなぐ。特定の世界観やキャラクターに依存する語は含めない。
// -------------------------------------------------------

import type { Perception } from "../types.js";

const PERCEPTION_LABELS: Record<keyof Perception, string> = {
  trust: "信頼",
  affection: "好感",
  respect: "尊敬",
  fear: "恐れ",
  dependence: "依存",
  familiarity: "親しみ",
};

function toLabel(value: number): string {
  if (value <= 20) return "ほとんど感じない";
  if (value <= 40) return "低い";
  if (value <= 60) return "標準";
  if (value <= 80) return "自覚している";
  return "強く感じる";
}

function formatState(obj: Record<string, number>, labels: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `・${labels[k] ?? k}：${v}（${toLabel(v)}）`)
    .join("\n");
}

/** perception を、プロンプトに載せる文章にする */
export function formatPerceptionForPrompt(perception: Perception): string {
  return formatState(
    perception as unknown as Record<string, number>,
    PERCEPTION_LABELS as Record<string, string>
  );
}
