import { describe, expect, it } from "vitest";
import { compareToBaseline, renderReport, summarize } from "./report.js";
import { makeModelCall, makeRunResult, makeScenario } from "./checks/fixtures.js";
import type { JudgeResult, RunResult, RunSummary } from "./types.js";

const baseOptions: RunSummary["options"] = {
  functions: ["dialogueGenerator", "absenceSimulator"],
  models: ["nova-lite", "nova-2-lite"],
  repeat: 2,
  maxCostUsd: 5,
  judgeModelId: "apac.anthropic.claude-haiku-4-5-v1:0",
};

const noJudgeOptions: RunSummary["options"] = {
  ...baseOptions,
  judgeModelId: null,
};

function makeJudge(overrides: Partial<JudgeResult> = {}): JudgeResult {
  return {
    judgeModelId: "apac.anthropic.claude-haiku-4-5-v1:0",
    scores: { characterVoice: 5, conversationalNaturalness: 3 },
    notApplicable: [],
    reasons: {
      characterVoice: "口調の例文どおりでキャラクターらしい",
      conversationalNaturalness: "反応がやや薄い",
    },
    comment: "全体的に良い応答",
    costUsd: 0.0002,
    latencyMs: 400,
    ...overrides,
  };
}

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

  it("averages judge scores per criterion excluding nulls, and counts judgedRuns", () => {
    const results = [
      dialogueResult({
        repeatIndex: 0,
        judge: makeJudge({ scores: { characterVoice: 5, conversationalNaturalness: 3 } }),
      }),
      dialogueResult({
        repeatIndex: 1,
        judge: makeJudge({ scores: { characterVoice: 3, conversationalNaturalness: null } }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const row = summary.rows[0];

    expect(row.judgedRuns).toBe(2);
    // characterVoice: (5 + 3) / 2 = 4
    expect(row.avgJudgeScores.characterVoice).toBeCloseTo(4, 6);
    // conversationalNaturalness: null を除くと 3 件中1件だけ -> 3
    expect(row.avgJudgeScores.conversationalNaturalness).toBeCloseTo(3, 6);
    // overall: (4 + 3) / 2 = 3.5
    expect(row.avgJudgeScoreOverall).toBeCloseTo(3.5, 6);
  });

  it("excludes notApplicable (null) scores from the average, same as any other null", () => {
    const results = [
      dialogueResult({
        repeatIndex: 0,
        judge: makeJudge({
          scores: { characterVoice: 5, conversationalNaturalness: null },
          notApplicable: ["conversationalNaturalness"],
        }),
      }),
      dialogueResult({
        repeatIndex: 1,
        judge: makeJudge({ scores: { characterVoice: 3, conversationalNaturalness: 4 } }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const row = summary.rows[0];

    // 対象外(null)は平均から除く: characterVoice (5+3)/2=4, conversationalNaturalness は1件だけ -> 4
    expect(row.avgJudgeScores.characterVoice).toBeCloseTo(4, 6);
    expect(row.avgJudgeScores.conversationalNaturalness).toBeCloseTo(4, 6);
    // judgedRuns 自体は「採点がエラーでない実行」の数で、対象外があっても変わらない
    expect(row.judgedRuns).toBe(2);
  });

  it("excludes a run whose judging itself errored from judgedRuns, but avgJudgeScoreOverall is null when there are no runs to score", () => {
    const results = [
      dialogueResult({
        judge: makeJudge({
          scores: { characterVoice: null, conversationalNaturalness: null },
          error: "ThrottlingException",
        }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const row = summary.rows[0];
    expect(row.judgedRuns).toBe(0);
    expect(row.avgJudgeScoreOverall).toBeNull();
  });

  it("computes judgeCostUsd (null treated as 0) and totalCostUsd = execution + judge, while avgCostUsd stays execution-only", () => {
    const results = [
      dialogueResult({
        repeatIndex: 0,
        metrics: { ...dialogueResult().metrics, costUsd: 0.001 },
        judge: makeJudge({ costUsd: 0.0002 }),
      }),
      dialogueResult({
        repeatIndex: 1,
        metrics: { ...dialogueResult().metrics, costUsd: 0.002 },
        judge: makeJudge({ costUsd: null }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");

    // 採点の料金の合計（null は0扱い）: 0.0002 + 0 = 0.0002
    expect(summary.judgeCostUsd).toBeCloseTo(0.0002, 6);
    // 総料金 = 実行の料金（0.001 + 0.002）+ 採点の料金（0.0002）
    expect(summary.totalCostUsd).toBeCloseTo(0.003 + 0.0002, 6);
    // 1回あたりの料金は実行の料金だけ（採点の料金を含めない）
    expect(summary.rows[0].avgCostUsd).toBeCloseTo(0.0015, 6);
  });

  it("has no judged runs, null scores, and zero judgeCostUsd when nothing was judged", () => {
    const results = [dialogueResult()];
    const summary = summarize(results, noJudgeOptions, "t0", "t1");
    const row = summary.rows[0];
    expect(row.judgedRuns).toBe(0);
    expect(row.avgJudgeScoreOverall).toBeNull();
    expect(Object.keys(row.avgJudgeScores)).toHaveLength(0);
    expect(summary.judgeCostUsd).toBe(0);
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
        emotions: { joy: 40, sadness: 0, hope: 0, anxiety: 0, relief: 0, disappointment: 0, pride: 0, shame: 0, gratitude: 0, admiration: 0, anger: 0, happyFor: 0, sympathy: 0 },
        mood: { pleasure: 20, arousal: 10, dominance: 5 },
        needs: { fatigue: 48, loneliness: 10 },
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

  it("shows the judge model/cost in conditions, the judge average column, the per-criterion section, and per-scenario scores", () => {
    const results = [
      dialogueResult({
        judge: makeJudge({
          scores: { characterVoice: 5, conversationalNaturalness: 3 },
          reasons: {
            characterVoice: "口調の例文どおり",
            conversationalNaturalness: "やや反応が薄い",
          },
          comment: "総じて自然",
        }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [
      makeScenario({ id: "dg-casual", function: "dialogueGenerator", description: "desc" }),
    ];

    const markdown = renderReport(summary, results, scenarios);

    // 実行の条件: 採点モデルと採点の料金
    expect(markdown).toContain("採点に使ったモデル: apac.anthropic.claude-haiku-4-5-v1:0");
    expect(markdown).toContain("採点の料金");

    // 機能ごとの集計: 採点の平均（全観点）列。 (4+3)... wait single run -> avg per criterion = score itself, overall = (5+3)/2 = 4.0
    expect(markdown).toContain("採点の平均（全観点）");
    expect(markdown).toContain("4.0");

    // 採点の観点ごとの平均の節
    expect(markdown).toContain("## 採点の観点ごとの平均");
    expect(markdown).toContain("characterVoice");
    expect(markdown).toContain("conversationalNaturalness");

    // シナリオごとの並べ比べに採点（観点ごとの点数・理由・総評）が出る
    expect(markdown).toContain("採点:");
    expect(markdown).toContain("5");
    expect(markdown).toContain("口調の例文どおり");
    expect(markdown).toContain("総評: 総じて自然");
  });

  it("appends the notApplicable count to the per-criterion table cell when some runs were marked not applicable", () => {
    const results = [
      dialogueResult({
        repeatIndex: 0,
        judge: makeJudge({
          scores: { characterVoice: 5, conversationalNaturalness: null },
          notApplicable: ["conversationalNaturalness"],
        }),
      }),
      dialogueResult({
        repeatIndex: 1,
        judge: makeJudge({ scores: { characterVoice: 3, conversationalNaturalness: 4 } }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [makeScenario({ id: "dg-casual", function: "dialogueGenerator", description: "desc" })];

    const markdown = renderReport(summary, results, scenarios);

    // characterVoice は誰も対象外にしていないので件数のみ
    expect(markdown).toContain("4.0（2件）");
    // conversationalNaturalness は1件が対象外なので、その旨を併記する（点数が付いたのは1件）
    expect(markdown).toContain("4.0（1件、対象外 1件）");
  });

  it("shows judge errors in the scenario comparison, and '-' / '採点なし' when nothing was judged", () => {
    const errored = dialogueResult({
      scenarioId: "dg-error",
      judge: makeJudge({
        scores: { characterVoice: null, conversationalNaturalness: null },
        error: "ThrottlingException",
      }),
    });
    const notJudged = dialogueResult({ scenarioId: "dg-no-judge" });

    const summary = summarize([notJudged], noJudgeOptions, "t0", "t1");
    const scenarios = [
      makeScenario({ id: "dg-error", function: "dialogueGenerator", description: "desc" }),
      makeScenario({ id: "dg-no-judge", function: "dialogueGenerator", description: "desc" }),
    ];

    const errorMarkdown = renderReport(summary, [errored], scenarios);
    expect(errorMarkdown).toContain("採点: エラー — ThrottlingException");

    const noJudgeMarkdown = renderReport(summary, [notJudged], scenarios);
    expect(noJudgeMarkdown).toContain("採点に使ったモデル: 採点なし");
    expect(noJudgeMarkdown).toContain("採点: なし");
    // 採点の観点ごとの平均: どのモデルにも観点が無いので (採点なし)
    expect(noJudgeMarkdown).toContain("## 採点の観点ごとの平均");
    expect(noJudgeMarkdown).toContain("(採点なし)");
  });

  it("shows '対象外' with its reason instead of a score in the scenario comparison", () => {
    const results = [
      dialogueResult({
        judge: makeJudge({
          scores: { characterVoice: 5, conversationalNaturalness: null },
          notApplicable: ["conversationalNaturalness"],
          reasons: {
            characterVoice: "口調の例文どおり",
            conversationalNaturalness: "続いている話題が無いシナリオのため評価対象外",
          },
        }),
      }),
    ];
    const summary = summarize(results, baseOptions, "t0", "t1");
    const scenarios = [makeScenario({ id: "dg-casual", function: "dialogueGenerator", description: "desc" })];

    const markdown = renderReport(summary, results, scenarios);

    expect(markdown).toContain("conversationalNaturalness: 対象外 — 続いている話題が無いシナリオのため評価対象外");
    // 対象外でない観点は通常どおり点数を表示する
    expect(markdown).toContain("characterVoice: 5 — 口調の例文どおり");
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
      judgeCostUsd: 0,
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
          judgedRuns: 0,
          avgJudgeScores: {},
          avgJudgeScoreOverall: null,
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

  it("adds the judge-average diff when both sides used the same judge model", () => {
    const currentResults = [
      dialogueResult({
        judge: makeJudge({ scores: { characterVoice: 5, conversationalNaturalness: 5 } }),
      }),
    ];
    const currentSummary = summarize(currentResults, baseOptions, "t0", "t1");

    const baselineResults = [
      dialogueResult({
        judge: makeJudge({ scores: { characterVoice: 3, conversationalNaturalness: 3 } }),
      }),
    ];
    const baselineSummaryFull = summarize(baselineResults, baseOptions, "t-1", "t-1");
    const baseline: RunSummary = { ...baselineSummaryFull, startedAt: "t-1", finishedAt: "t-1" };

    const markdown = compareToBaseline(currentSummary, baseline);

    // 今回 5.0（characterVoice, conversationalNaturalness とも5） vs 基準 3.0 -> 差 +2.0
    expect(markdown).toContain("5.0（基準比 +2.0）");
    expect(markdown).not.toContain("採点に使ったモデルが違う");
  });

  it("notes that judge scores are not comparable when the judge model differs between current and baseline", () => {
    const currentResults = [
      dialogueResult({
        judge: makeJudge({ scores: { characterVoice: 5, conversationalNaturalness: 5 } }),
      }),
    ];
    const currentSummary = summarize(currentResults, baseOptions, "t0", "t1");

    const baselineOptions: RunSummary["options"] = {
      ...baseOptions,
      judgeModelId: "apac.anthropic.claude-sonnet-4-5-v1:0",
    };
    const baselineResults = [
      dialogueResult({
        judge: makeJudge({
          judgeModelId: "apac.anthropic.claude-sonnet-4-5-v1:0",
          scores: { characterVoice: 3, conversationalNaturalness: 3 },
        }),
      }),
    ];
    const baselineSummaryFull = summarize(baselineResults, baselineOptions, "t-1", "t-1");
    const baseline: RunSummary = { ...baselineSummaryFull, startedAt: "t-1", finishedAt: "t-1" };

    const markdown = compareToBaseline(currentSummary, baseline);

    expect(markdown).toContain(
      "採点に使ったモデルが違うので、採点の点数は比べられない"
    );
    // 差分（基準比）としては出さない
    expect(markdown).not.toContain("5.0（基準比");
  });
});
