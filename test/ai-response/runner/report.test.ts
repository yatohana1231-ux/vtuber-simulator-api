import { describe, expect, it } from "vitest";
import { compareToBaseline, renderReport, summarize } from "./report.js";
import { makeModelCall, makeRunResult, makeScenario } from "./checks/fixtures.js";
import type { RunResult, RunSummary } from "./types.js";

const baseOptions: RunSummary["options"] = {
  functions: ["dialogueGenerator", "absenceSimulator"],
  models: ["nova-lite", "nova-2-lite"],
  repeat: 2,
  maxCostUsd: 5,
};

function dialogueResult(overrides: Partial<RunResult> = {}): RunResult {
  return makeRunResult({
    scenarioId: "dg-casual",
    function: "dialogueGenerator",
    modelKey: "nova-lite",
    modelId: "apac.amazon.nova-lite-v1:0",
    output: "ありがとう！今日は配信だよ。",
    modelCalls: [makeModelCall({ usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 } })],
    checks: [
      { type: "maxLength", passed: true },
      { type: "politenessStyle", passed: true },
    ],
    metrics: {
      totalLatencyMs: 500,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      costUsd: 0.001,
    },
    ...overrides,
  });
}

describe("summarize", () => {
  it("aggregates runs into one row per function x model", () => {
    const results = [
      dialogueResult({ repeatIndex: 0 }),
      dialogueResult({
        repeatIndex: 1,
        checks: [
          { type: "maxLength", passed: true },
          { type: "politenessStyle", passed: false, detail: "丁寧語が混ざっている" },
        ],
        metrics: {
          totalLatencyMs: 700,
          inputTokens: 120,
          outputTokens: 25,
          cacheReadInputTokens: 50,
          cacheWriteInputTokens: 0,
          costUsd: 0.002,
        },
      }),
    ];

    const summary = summarize(results, baseOptions, "2026-09-19T00:00:00.000Z", "2026-09-19T00:05:00.000Z");

    expect(summary.rows).toHaveLength(1);
    const row = summary.rows[0];
    expect(row.function).toBe("dialogueGenerator");
    expect(row.modelKey).toBe("nova-lite");
    expect(row.runs).toBe(2);
    expect(row.errors).toBe(0);
    expect(row.checksPassed).toBe(3);
    expect(row.checksTotal).toBe(4);
    expect(row.avgCostUsd).toBeCloseTo(0.0015, 6);
    expect(row.avgLatencyMs).toBeCloseTo(600, 6);
    // cacheReadRatio = totalCacheRead / (totalInput + totalCacheRead + totalCacheWrite)
    //               = 50 / (220 + 50 + 0)
    expect(row.cacheReadRatio).toBeCloseTo(50 / 270, 6);
    expect(summary.totalCostUsd).toBeCloseTo(0.003, 6);
  });

  it("treats a run with a null cost as excluded from the average, not zero", () => {
    const results = [dialogueResult({ metrics: { ...dialogueResult().metrics, costUsd: null } })];
    const summary = summarize(results, baseOptions, "t0", "t1");
    expect(summary.rows[0].avgCostUsd).toBeNull();
  });

  it("counts errors and keeps cacheReadRatio at 0 when there is no token usage", () => {
    const results = [
      makeRunResult({
        function: "memoryRetriever",
        modelKey: "nova-lite",
        error: "ValidationException",
        checks: [{ type: "modelResponded", passed: false, detail: "run* が例外を投げた" }],
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    expect(summary.rows[0].errors).toBe(1);
    expect(summary.rows[0].cacheReadRatio).toBe(0);
  });
});

describe("renderReport", () => {
  it("includes the main headings and key values", () => {
    const results = [dialogueResult()];
    const summary = summarize(results, baseOptions, "2026-09-19T00:00:00.000Z", "2026-09-19T00:05:00.000Z");
    const scenarios = [
      makeScenario({
        id: "dg-casual",
        function: "dialogueGenerator",
        description: "雑談への応答（カジュアル口調を期待）",
      }),
    ];

    const markdown = renderReport(summary, results, scenarios);

    expect(markdown).toContain("# AI 応答テスト レポート");
    expect(markdown).toContain("## 実行の条件");
    expect(markdown).toContain("## 機能ごとの集計");
    expect(markdown).toContain("## 判定の種類ごとの合格率");
    expect(markdown).toContain("## シナリオごとの並べ比べ");
    expect(markdown).toContain("dialogueGenerator");
    expect(markdown).toContain("nova-lite");
    expect(markdown).toContain("雑談への応答（カジュアル口調を期待）");
    expect(markdown).toContain("ありがとう！今日は配信だよ。");
    expect(markdown).toContain("maxLength");
  });

  it("shows failed check details for the scenario comparison", () => {
    const results = [
      dialogueResult({
        checks: [{ type: "politenessStyle", passed: false, detail: "です・ます調が混ざっている" }],
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [makeScenario({ id: "dg-casual", function: "dialogueGenerator", description: "desc" })];

    const markdown = renderReport(summary, results, scenarios);
    expect(markdown).toContain("不合格");
    expect(markdown).toContain("です・ます調が混ざっている");
  });

  it("previews absenceSimulator/emotionUpdater/memoryRetriever output shapes", () => {
    const absenceResult = makeRunResult({
      scenarioId: "as-1",
      function: "absenceSimulator",
      modelKey: "nova-lite",
      output: {
        events: [{ kind: "daily", summary: "友達と話した", detail: "d" }],
        actions: [{ startDatetime: "2026-09-18T13:00:00.000Z", endDatetime: "2026-09-18T14:00:00.000Z", action: "勉強した", memo: "" }],
      },
    });
    const emotionResult = makeRunResult({
      scenarioId: "eu-1",
      function: "emotionUpdater",
      modelKey: "nova-lite",
      output: {
        mood: { joy: 40, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
        perception: { trust: 72, affection: 55, respect: 80, fear: 12, dependence: 30, familiarity: 65 },
      },
    });
    const memoryResult = makeRunResult({
      scenarioId: "mr-1",
      function: "memoryRetriever",
      modelKey: "nova-lite",
      writes: [
        {
          table: "characterMemory",
          operation: "put",
          item: { memory_id: "c1", index: "i1", eventSummary: "週末に遊ぶ約束をした" },
        },
      ],
    });

    const results = [absenceResult, emotionResult, memoryResult];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [
      makeScenario({ id: "as-1", function: "absenceSimulator", description: "desc" }),
      makeScenario({ id: "eu-1", function: "emotionUpdater", description: "desc" }),
      makeScenario({ id: "mr-1", function: "memoryRetriever", description: "desc" }),
    ];

    const markdown = renderReport(summary, results, scenarios);
    expect(markdown).toContain("友達と話した");
    expect(markdown).toContain("勉強した");
    expect(markdown).toContain("joy");
    expect(markdown).toContain("週末に遊ぶ約束をした");
  });

  it("keeps scenarios with the same id but different functions separate (scenario id is only unique within a function)", () => {
    const dialogueSample = makeRunResult({
      scenarioId: "sample-basic",
      function: "dialogueGenerator",
      modelKey: "nova-lite",
      output: "今日は元気だよ！",
    });
    const absenceSample = makeRunResult({
      scenarioId: "sample-basic",
      function: "absenceSimulator",
      modelKey: "nova-lite",
      output: {
        events: [{ kind: "daily", summary: "図書館で勉強した", detail: "d" }],
        actions: [],
      },
    });

    const results = [dialogueSample, absenceSample];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [
      makeScenario({ id: "sample-basic", function: "dialogueGenerator", description: "dialogueGenerator のサンプル" }),
      makeScenario({ id: "sample-basic", function: "absenceSimulator", description: "absenceSimulator のサンプル" }),
    ];

    const markdown = renderReport(summary, results, scenarios);

    // 機能名を見出しに含め、機能ごとに別の見出しになっていること
    expect(markdown).toContain("### dialogueGenerator / sample-basic");
    expect(markdown).toContain("### absenceSimulator / sample-basic");

    // 各見出しの下に、その機能自身の結果だけが出ていること（他の機能の出力が混ざらない）
    const dialogueSection = markdown
      .split("### dialogueGenerator / sample-basic")[1]
      .split("### absenceSimulator / sample-basic")[0];
    expect(dialogueSection).toContain("今日は元気だよ！");
    expect(dialogueSection).not.toContain("図書館で勉強した");

    const absenceSection = markdown.split("### absenceSimulator / sample-basic")[1];
    expect(absenceSection).toContain("図書館で勉強した");
    expect(absenceSection).not.toContain("今日は元気だよ！");
  });
});

describe("compareToBaseline", () => {
  it("shows rows present in both, and marks rows unique to either side", () => {
    const results = [dialogueResult()];
    const currentSummary = summarize(results, baseOptions, "t0", "t1");

    const baselineRow = currentSummary.rows[0];
    const baseline: RunSummary = {
      startedAt: "t-1",
      finishedAt: "t-1",
      options: baseOptions,
      totalCostUsd: 0.0005,
      rows: [
        { ...baselineRow, checksPassed: 1, checksTotal: 2, avgCostUsd: 0.0005, avgLatencyMs: 1000 },
        {
          function: "memoryRetriever",
          modelKey: "nova-lite",
          modelId: "apac.amazon.nova-lite-v1:0",
          runs: 3,
          errors: 0,
          checksPassed: 3,
          checksTotal: 3,
          avgCostUsd: 0.0001,
          avgLatencyMs: 300,
          avgInputTokens: 50,
          avgOutputTokens: 10,
          cacheReadRatio: 0,
        },
      ],
    };

    const markdown = compareToBaseline(currentSummary, baseline);

    expect(markdown).toContain("# 基準との比較");
    expect(markdown).toContain("dialogueGenerator");
    expect(markdown).toContain("基準比");
    // memoryRetriever only exists in the baseline
    expect(markdown).toContain("memoryRetriever");
    expect(markdown).toContain("今回に無い");
  });
});
