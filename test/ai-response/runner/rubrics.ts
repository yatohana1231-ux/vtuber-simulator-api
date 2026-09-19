// -------------------------------------------------------
// LLM による採点の評価基準（rubrics/<機能名>.md）の読み込み
//
// 書式は rubrics/README.md を参照。見出し（`### id: 名前`）ごとに、説明（見出しの下、
// アンカー行を除いた行）と、`- 5:`・`- 3:`・`- 1:` のアンカー3行を読み取る。
// 崩れた書式（アンカーが欠けている、観点が1つも無い等）は、どのファイルの何が
// 問題かがわかる例外にする。
// -------------------------------------------------------

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RubricCriterion, TargetFunction } from "./types.js";

// api/test/ai-response/rubrics（このファイルは runner/ 配下）
const DEFAULT_RUBRICS_DIR = path.resolve(fileURLToPath(import.meta.url), "../../rubrics");

const HEADING_PATTERN = /^###\s+([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/;
const ANCHOR_PATTERN = /^-\s*(5|3|1)\s*:\s*(.+)$/;

function fail(filePath: string, message: string): never {
  throw new Error(`rubrics: ${filePath}: ${message}`);
}

/**
 * 評価基準の Markdown 文字列を RubricCriterion[] にする。
 * filePath はエラーメッセージにだけ使う（どのファイルかを示すため）。
 */
export function parseRubric(markdown: string, filePath: string): RubricCriterion[] {
  const lines = markdown.split("\n");
  const criteria: RubricCriterion[] = [];

  let i = 0;
  while (i < lines.length) {
    const headingMatch = HEADING_PATTERN.exec(lines[i].trim());
    if (!headingMatch) {
      i++;
      continue;
    }

    const [, id, rawName] = headingMatch;
    i++;

    const descriptionLines: string[] = [];
    const anchors: Partial<Record<5 | 3 | 1, string>> = {};

    while (i < lines.length && !/^###\s/.test(lines[i].trim())) {
      const line = lines[i];
      const trimmed = line.trim();
      const anchorMatch = ANCHOR_PATTERN.exec(trimmed);
      if (anchorMatch) {
        const score = Number(anchorMatch[1]) as 5 | 3 | 1;
        if (anchors[score] !== undefined) {
          fail(filePath, `観点 "${id}" のアンカー "${score}" が重複しています`);
        }
        anchors[score] = anchorMatch[2].trim();
      } else if (trimmed !== "" && !trimmed.startsWith("-")) {
        descriptionLines.push(trimmed);
      }
      i++;
    }

    if (anchors[5] === undefined || anchors[3] === undefined || anchors[1] === undefined) {
      const missing = ([5, 3, 1] as const).filter((s) => anchors[s] === undefined);
      fail(filePath, `観点 "${id}" に "- ${missing.join('"・"- ')}:" のアンカーが揃っていません`);
    }

    const description = descriptionLines.join("\n").trim();
    if (description === "") {
      fail(filePath, `観点 "${id}" の説明がありません`);
    }

    criteria.push({
      id,
      name: rawName.trim(),
      description,
      anchors: { 5: anchors[5], 3: anchors[3], 1: anchors[1] },
    });
  }

  if (criteria.length === 0) {
    fail(filePath, "観点（### id: 名前 の見出し）が1つも見つかりません");
  }

  return criteria;
}

/** rubrics/<機能名>.md を読み、RubricCriterion[] にする */
export async function loadRubric(
  fn: TargetFunction,
  rubricsDir: string = DEFAULT_RUBRICS_DIR
): Promise<RubricCriterion[]> {
  const filePath = path.join(rubricsDir, `${fn}.md`);
  const raw = await readFile(filePath, "utf8");
  return parseRubric(raw, filePath);
}
