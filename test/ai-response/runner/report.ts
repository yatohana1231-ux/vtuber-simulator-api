// -------------------------------------------------------
// AI 応答テストの集計とレポート（Markdown、日本語）。
//
// - summarize: 実行結果（RunResult[]）を機能 × モデルごとに集計する（SummaryRow[]）。
// - renderReport: 集計とシナリオの並べ比べを Markdown にする。
// - compareToBaseline: 今回の集計と、以前保存した集計（基準）を比べる Markdown を作る。
// -------------------------------------------------------

import type {
  CheckResult,
  RunResult,
  RunSummary,
  Scenario,
  SummaryRow,
  TargetFunction,
} from "./types.js";
import type {
  AbsenceSimulatorResult,
  DialogueGeneratorResponse,
  EmotionUpdaterResponse,
} from "../../../src/types.js";
import { getSavedAbsenceRecord } from "./checks/absenceSimulator.js";
import { getSavedMemories } from "./checks/memoryRetriever.js";

// -------------------------------------------------------
// 数値ヘルパー
// -------------------------------------------------------

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function formatPercent(passed: number, total: number): string {
  if (total === 0) return "-";
  return `${((passed / total) * 100).toFixed(1)}%`;
}

function formatCostUsd(value: number | null): string {
  return value === null ? "不明" : `$${value.toFixed(5)}`;
}

function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}ms`;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("ja-JP");
}

function formatJudgeScore(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function truncate(text: string, maxLength = 200): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, maxLength).join("")}…`;
}

// -------------------------------------------------------
// summarize
// -------------------------------------------------------

function groupKey(functionName: TargetFunction, modelKey: string): string {
  return `${functionName}::${modelKey}`;
}

export function summarize(
  results: RunResult[],
  options: RunSummary["options"],
  startedAt: string,
  finishedAt: string
): RunSummary {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = groupKey(r.function, r.modelKey);
    const list = groups.get(key);
    if (list) {
      list.push(r);
    } else {
      groups.set(key, [r]);
    }
  }

  const rows: SummaryRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];

    let checksPassed = 0;
    let checksTotal = 0;
    for (const r of group) {
      checksTotal += r.checks.length;
      checksPassed += r.checks.filter((c) => c.passed).length;
    }

    const costs = group
      .map((r) => r.metrics.costUsd)
      .filter((c): c is number => c !== null);
    const avgCostUsd = costs.length > 0 ? average(costs) : null;

    const totalInput = sum(group.map((r) => r.metrics.inputTokens));
    const totalCacheRead = sum(group.map((r) => r.metrics.cacheReadInputTokens));
    const totalCacheWrite = sum(group.map((r) => r.metrics.cacheWriteInputTokens));
    const cacheDenominator = totalInput + totalCacheRead + totalCacheWrite;

    // 採点した実行（judge があり、採点自体がエラーになっていない実行）だけを「採点した実行」として数える。
    const judgedRuns = group.filter((r) => r.judge && !r.judge.error).length;

    // 観点の id は、このグループ（機能 × モデル）の実行に出てきたものすべてを集める
    // （採点がエラーの実行の scores も、値が全て null なだけで id 自体は含まれ得る）。
    const criterionIds = new Set<string>();
    for (const r of group) {
      if (r.judge) {
        for (const id of Object.keys(r.judge.scores)) criterionIds.add(id);
      }
    }

    const avgJudgeScores: Record<string, number | null> = {};
    for (const id of criterionIds) {
      const values: number[] = [];
      for (const r of group) {
        const score = r.judge?.scores[id];
        if (typeof score === "number") values.push(score);
      }
      avgJudgeScores[id] = values.length > 0 ? average(values) : null;
    }

    const nonNullCriterionAverages = Object.values(avgJudgeScores).filter(
      (v): v is number => v !== null
    );
    const avgJudgeScoreOverall =
      nonNullCriterionAverages.length > 0 ? average(nonNullCriterionAverages) : null;

    rows.push({
      function: first.function,
      modelKey: first.modelKey,
      modelId: first.modelId,
      runs: group.length,
      errors: group.filter((r) => r.error).length,
      checksPassed,
      checksTotal,
      avgCostUsd,
      avgLatencyMs: average(group.map((r) => r.metrics.totalLatencyMs)),
      avgInputTokens: average(group.map((r) => r.metrics.inputTokens)),
      avgOutputTokens: average(group.map((r) => r.metrics.outputTokens)),
      cacheReadRatio: cacheDenominator > 0 ? totalCacheRead / cacheDenominator : 0,
      judgedRuns,
      avgJudgeScores,
      avgJudgeScoreOverall,
    });
  }

  rows.sort(
    (a, b) => a.function.localeCompare(b.function) || a.modelKey.localeCompare(b.modelKey)
  );

  // 実行（run*）自体の料金。採点の料金は含めない（avgCostUsd と同じ考え方）。
  const executionCostUsd = sum(
    results.map((r) => r.metrics.costUsd).filter((c): c is number => c !== null)
  );
  // 採点の料金（null は0扱い）。
  const judgeCostUsd = sum(results.map((r) => r.judge?.costUsd ?? 0));
  const totalCostUsd = executionCostUsd + judgeCostUsd;

  return { startedAt, finishedAt, options, totalCostUsd, judgeCostUsd, rows };
}

// -------------------------------------------------------
// renderReport
// -------------------------------------------------------

function renderConditionsSection(summary: RunSummary): string {
  const { options } = summary;
  const lines = [
    "## 実行の条件",
    "",
    `- 実行日時: ${summary.startedAt} 〜 ${summary.finishedAt}`,
    `- 機能: ${options.functions.join(", ") || "(なし)"}`,
    `- モデル: ${options.models.join(", ") || "(なし)"}`,
    `- 繰り返し回数: ${options.repeat}`,
    `- 料金の上限: $${options.maxCostUsd}`,
    `- 採点に使ったモデル: ${options.judgeModelId ?? "採点なし"}`,
    `- 採点の料金: ${formatCostUsd(summary.judgeCostUsd)}`,
    `- 総料金: ${formatCostUsd(summary.totalCostUsd)}`,
  ];
  return lines.join("\n");
}

function renderSummaryTable(summary: RunSummary): string {
  const header =
    "| 機能 | モデル | 実行数 | エラー | ルールの合格率 | 1回あたりの料金 | 平均所要時間 | 平均入力/出力トークン | キャッシュの読み出し率 | 採点の平均（全観点） |\n" +
    "|---|---|---|---|---|---|---|---|---|---|";
  const rows = summary.rows.map((row) => {
    return (
      `| ${row.function} | ${row.modelKey} | ${row.runs} | ${row.errors} | ` +
      `${formatPercent(row.checksPassed, row.checksTotal)} | ${formatCostUsd(row.avgCostUsd)} | ` +
      `${formatMs(row.avgLatencyMs)} | ${formatNumber(row.avgInputTokens)} / ${formatNumber(row.avgOutputTokens)} | ` +
      `${(row.cacheReadRatio * 100).toFixed(1)}% | ${formatJudgeScore(row.avgJudgeScoreOverall)} |`
    );
  });
  return ["## 機能ごとの集計", "", header, ...rows].join("\n");
}

interface JudgeCriterionTally {
  /** 点数が付いた実行の数 */
  scored: number;
  /** 対象外と判定された実行の数 */
  notApplicable: number;
}

/**
 * 機能 × モデル × 観点ごとに、点数が付いた実行の数と対象外になった実行の数を数える。
 * 採点自体がエラーだった実行は数えない（scores が全て null で、対象外かどうか判断できないため）。
 */
function tallyJudgeCriteria(results: RunResult[]): Map<string, JudgeCriterionTally> {
  const tallies = new Map<string, JudgeCriterionTally>();
  for (const r of results) {
    if (!r.judge || r.judge.error) continue;
    for (const [id, score] of Object.entries(r.judge.scores)) {
      const key = `${r.function}::${r.modelKey}::${id}`;
      const existing = tallies.get(key) ?? { scored: 0, notApplicable: 0 };
      if (score !== null) {
        existing.scored += 1;
      } else if (r.judge.notApplicable.includes(id)) {
        existing.notApplicable += 1;
      }
      tallies.set(key, existing);
    }
  }
  return tallies;
}

function renderJudgeScoresByCriterionSection(summary: RunSummary, results: RunResult[]): string {
  const byFunction = new Map<TargetFunction, SummaryRow[]>();
  for (const row of summary.rows) {
    const list = byFunction.get(row.function);
    if (list) {
      list.push(row);
    } else {
      byFunction.set(row.function, [row]);
    }
  }

  const criterionTallies = tallyJudgeCriteria(results);

  const functions = [...byFunction.keys()].sort();
  const sections: string[] = [];

  for (const fn of functions) {
    const rows = byFunction.get(fn)!;
    const criterionIds = [...new Set(rows.flatMap((r) => Object.keys(r.avgJudgeScores)))].sort();
    if (criterionIds.length === 0) continue;

    const header =
      `| モデル | ${criterionIds.join(" | ")} |\n` +
      `|---|${criterionIds.map(() => "---").join("|")}|`;
    const rowLines = rows.map((row) => {
      const cells = criterionIds.map((id) => {
        const value = row.avgJudgeScores[id] ?? null;
        const tally = criterionTallies.get(`${row.function}::${row.modelKey}::${id}`) ?? {
          scored: 0,
          notApplicable: 0,
        };
        const countText =
          tally.notApplicable > 0
            ? `${tally.scored}件、対象外 ${tally.notApplicable}件`
            : `${tally.scored}件`;
        return `${formatJudgeScore(value)}（${countText}）`;
      });
      return `| ${row.modelKey} | ${cells.join(" | ")} |`;
    });

    sections.push([`### ${fn}`, "", header, ...rowLines].join("\n"));
  }

  const body = sections.length > 0 ? sections.join("\n\n") : "(採点なし)";
  return ["## 採点の観点ごとの平均", "", body].join("\n");
}

interface CheckTypeTally {
  function: TargetFunction;
  modelKey: string;
  type: string;
  passed: number;
  total: number;
}

function tallyByCheckType(results: RunResult[]): CheckTypeTally[] {
  const tallies = new Map<string, CheckTypeTally>();
  for (const r of results) {
    for (const c of r.checks) {
      const key = `${r.function}::${r.modelKey}::${c.type}`;
      const existing = tallies.get(key);
      if (existing) {
        existing.total += 1;
        if (c.passed) existing.passed += 1;
      } else {
        tallies.set(key, {
          function: r.function,
          modelKey: r.modelKey,
          type: c.type,
          passed: c.passed ? 1 : 0,
          total: 1,
        });
      }
    }
  }
  return [...tallies.values()].sort(
    (a, b) =>
      a.function.localeCompare(b.function) ||
      a.modelKey.localeCompare(b.modelKey) ||
      a.type.localeCompare(b.type)
  );
}

function renderCheckTypeTable(results: RunResult[]): string {
  const tallies = tallyByCheckType(results);
  const header = "| 機能 | モデル | 判定の種類 | 合格率 |\n|---|---|---|---|";
  if (tallies.length === 0) {
    return ["## 判定の種類ごとの合格率", "", "(判定結果が無い)"].join("\n");
  }
  const rows = tallies.map(
    (t) => `| ${t.function} | ${t.modelKey} | ${t.type} | ${formatPercent(t.passed, t.total)} |`
  );
  return ["## 判定の種類ごとの合格率", "", header, ...rows].join("\n");
}

function renderFailedChecks(checks: CheckResult[]): string {
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) return "  - 不合格の判定: なし";
  return failed
    .map((c) => `  - 不合格: \`${c.type}\`${c.detail ? ` — ${truncate(c.detail, 200)}` : ""}`)
    .join("\n");
}

function renderOutputPreview(result: RunResult): string {
  if (result.error) {
    return `  - エラー: ${truncate(result.error, 200)}`;
  }

  switch (result.function) {
    case "dialogueGenerator": {
      const reply =
        typeof result.output === "string"
          ? result.output
          : (result.output as DialogueGeneratorResponse | undefined)?.reply ?? "(出力なし)";
      return `  - reply: ${truncate(reply, 200)}`;
    }
    case "absenceSimulator": {
      const output = result.output as AbsenceSimulatorResult | undefined;
      if (!output) return "  - (出力なし)";
      const events = output.events.map((e) => `${e.kind}: ${e.summary}`).join(" / ");
      const actions = output.actions
        .map((a) => `${a.startDatetime}〜${a.endDatetime} ${a.action}`)
        .join(" / ");
      return [
        `  - 出来事: ${truncate(events || "(なし)", 300)}`,
        `  - 行動: ${truncate(actions || "(なし)", 300)}`,
      ].join("\n");
    }
    case "emotionUpdater": {
      // D-040 フェーズ16: 差分は実行前の状態（result.preAffectState）との比較で出す
      // （DEFAULT_MOOD/DEFAULT_PERCEPTION のような固定の既定値は使わない。
      // mood は PAD の3軸、emotions・needs も差分として見せる）
      const output = result.output as EmotionUpdaterResponse | undefined;
      if (!output) return "  - (出力なし)";
      const before = result.preAffectState;
      const emotionsDeltas = formatDeltas(
        output.emotions as unknown as Record<string, number>,
        before.emotions as unknown as Record<string, number>
      );
      const moodDeltas = formatDeltas(
        output.mood as unknown as Record<string, number>,
        before.mood as unknown as Record<string, number>
      );
      const needsDeltas = formatDeltas(
        output.needs as unknown as Record<string, number>,
        before.needs as unknown as Record<string, number>
      );
      const perceptionDeltas = formatDeltas(
        output.perception as unknown as Record<string, number>,
        before.perception as unknown as Record<string, number>
      );
      return [
        `  - emotions の変化: ${emotionsDeltas}`,
        `  - mood(PAD) の変化: ${moodDeltas}`,
        `  - needs の変化: ${needsDeltas}`,
        `  - perception の変化: ${perceptionDeltas}`,
      ].join("\n");
    }
    case "memoryRetriever": {
      const saved = getSavedMemories(result);
      if (saved.length === 0) return "  - 保存された記憶: なし";
      const summaries = saved.map((m) => m.eventSummary ?? "(eventSummary 無し)").join(" / ");
      return `  - 保存された記憶（${saved.length}件）: ${truncate(summaries, 300)}`;
    }
    default:
      return "  - (未知の機能)";
  }
}

function formatDeltas(
  after: Record<string, number>,
  before: Record<string, number>
): string {
  const parts = Object.keys(after).map((key) => {
    const delta = after[key] - (before[key] ?? 0);
    const sign = delta > 0 ? "+" : "";
    return `${key}${sign}${delta}`;
  });
  return parts.join(", ");
}

function renderJudgePreview(result: RunResult): string {
  if (!result.judge) return "  - 採点: なし";
  if (result.judge.error) {
    return `  - 採点: エラー — ${truncate(result.judge.error, 200)}`;
  }

  const lines = ["  - 採点:"];
  for (const [id, score] of Object.entries(result.judge.scores)) {
    const scoreText = result.judge.notApplicable.includes(id)
      ? "対象外"
      : score === null
        ? "-"
        : String(score);
    const reason = result.judge.reasons[id];
    lines.push(`    - ${id}: ${scoreText}${reason ? ` — ${truncate(reason, 150)}` : ""}`);
  }
  if (result.judge.comment) {
    lines.push(`    - 総評: ${truncate(result.judge.comment, 150)}`);
  }
  return lines.join("\n");
}

function renderScenarioComparison(results: RunResult[], scenarios: Scenario[]): string {
  const lines = ["## シナリオごとの並べ比べ", ""];

  if (scenarios.length === 0) {
    lines.push("(シナリオが無い)");
    return lines.join("\n");
  }

  for (const scenario of scenarios) {
    // シナリオの id は機能の中でだけ一意（scenarios/<機能名>/<id>.json）なので、
    // function と scenarioId の組で照合する（そうしないと、別の機能の同名シナリオの
    // 結果まで混ざってしまう）。
    const scenarioResults = results.filter(
      (r) => r.function === scenario.function && r.scenarioId === scenario.id && r.repeatIndex === 0
    );
    lines.push(`### ${scenario.function} / ${scenario.id}`, "", scenario.description, "");
    if (scenarioResults.length === 0) {
      lines.push("(実行結果が無い)", "");
      continue;
    }

    const byModel = new Map<string, RunResult>();
    for (const r of scenarioResults) {
      if (!byModel.has(r.modelKey)) byModel.set(r.modelKey, r);
    }

    for (const [modelKey, result] of byModel) {
      lines.push(
        `- モデル: ${modelKey}`,
        renderOutputPreview(result),
        renderFailedChecks(result.checks),
        renderJudgePreview(result)
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderReport(summary: RunSummary, results: RunResult[], scenarios: Scenario[]): string {
  return [
    "# AI 応答テスト レポート",
    "",
    renderConditionsSection(summary),
    "",
    renderSummaryTable(summary),
    "",
    renderJudgeScoresByCriterionSection(summary, results),
    "",
    renderCheckTypeTable(results),
    "",
    renderScenarioComparison(results, scenarios),
  ].join("\n");
}

// -------------------------------------------------------
// compareToBaseline
// -------------------------------------------------------

function formatDiff(current: number, base: number, formatter: (v: number) => string): string {
  const diff = current - base;
  const sign = diff > 0 ? "+" : "";
  return `${formatter(current)}（基準比 ${sign}${formatter(diff)}）`;
}

export function compareToBaseline(summary: RunSummary, baseline: RunSummary): string {
  const currentByKey = new Map(
    summary.rows.map((r) => [groupKey(r.function, r.modelKey), r] as const)
  );
  const baselineByKey = new Map(
    baseline.rows.map((r) => [groupKey(r.function, r.modelKey), r] as const)
  );

  const allKeys = [...new Set([...currentByKey.keys(), ...baselineByKey.keys()])].sort();

  const sameJudgeModel = summary.options.judgeModelId === baseline.options.judgeModelId;

  const header =
    "| 機能 | モデル | 合格率（今回 / 基準） | 料金（今回 / 基準） | 所要時間（今回 / 基準） | 採点の平均（今回 / 基準） |\n" +
    "|---|---|---|---|---|---|";

  const rows = allKeys.map((key) => {
    const current = currentByKey.get(key);
    const base = baselineByKey.get(key);

    if (current && !base) {
      const judgeCell = `${formatJudgeScore(current.avgJudgeScoreOverall)}（基準に無い）`;
      return `| ${current.function} | ${current.modelKey} | ${formatPercent(current.checksPassed, current.checksTotal)}（基準に無い） | ${formatCostUsd(current.avgCostUsd)}（基準に無い） | ${formatMs(current.avgLatencyMs)}（基準に無い） | ${judgeCell} |`;
    }
    if (!current && base) {
      const judgeCell = `（今回に無い）基準: ${formatJudgeScore(base.avgJudgeScoreOverall)}`;
      return `| ${base.function} | ${base.modelKey} | （今回に無い）基準: ${formatPercent(base.checksPassed, base.checksTotal)} | （今回に無い）基準: ${formatCostUsd(base.avgCostUsd)} | （今回に無い）基準: ${formatMs(base.avgLatencyMs)} | ${judgeCell} |`;
    }

    const c = current!;
    const b = base!;
    const currentRate = c.checksTotal > 0 ? (c.checksPassed / c.checksTotal) * 100 : 0;
    const baseRate = b.checksTotal > 0 ? (b.checksPassed / b.checksTotal) * 100 : 0;
    const rateCell = `${formatPercent(c.checksPassed, c.checksTotal)}（基準比 ${
      currentRate - baseRate >= 0 ? "+" : ""
    }${(currentRate - baseRate).toFixed(1)}pt）`;

    const costCell =
      c.avgCostUsd === null || b.avgCostUsd === null
        ? `${formatCostUsd(c.avgCostUsd)}（基準: ${formatCostUsd(b.avgCostUsd)}）`
        : formatDiff(c.avgCostUsd, b.avgCostUsd, (v) => `$${v.toFixed(5)}`);

    const latencyCell = formatDiff(c.avgLatencyMs, b.avgLatencyMs, formatMs);

    let judgeCell: string;
    if (!sameJudgeModel) {
      judgeCell = `${formatJudgeScore(c.avgJudgeScoreOverall)} / ${formatJudgeScore(b.avgJudgeScoreOverall)}（比較不可）`;
    } else if (c.avgJudgeScoreOverall === null || b.avgJudgeScoreOverall === null) {
      judgeCell = `${formatJudgeScore(c.avgJudgeScoreOverall)}（基準: ${formatJudgeScore(b.avgJudgeScoreOverall)}）`;
    } else {
      judgeCell = formatDiff(c.avgJudgeScoreOverall, b.avgJudgeScoreOverall, (v) => v.toFixed(1));
    }

    return `| ${c.function} | ${c.modelKey} | ${rateCell} | ${costCell} | ${latencyCell} | ${judgeCell} |`;
  });

  const lines = ["# 基準との比較", ""];
  if (!sameJudgeModel) {
    lines.push(
      "(注: 基準と今回で採点に使ったモデルが違うので、採点の点数は比べられない)",
      ""
    );
  }
  lines.push(header, ...rows);

  return lines.join("\n");
}
