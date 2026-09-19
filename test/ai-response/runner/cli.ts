// -------------------------------------------------------
// AI 応答テストのエントリーポイント
//
// 使い方は npm run test:ai -- <引数>（api/test/ai-response/run.mjs が esbuild でバンドルしてから
// このファイルを実行する）。流れ: シナリオを読む → 計画（シナリオ×モデル×繰り返し）→
// 見積もりを表示 → 上限を超えるなら終了（終了コード2）→ --dry-run ならここで終了 →
// モデルごとに順に実行（同じモデル内は concurrency で並行）→ 実行中も実際の料金を足していき、
// 上限を超えたら残りを打ち切る → 判定（checks）→ 結果の保存 → 集計とレポート。
//
// dynamo.ts・packages.ts はモジュール読み込み時に環境変数（CONTENT_DIR・テーブル名）を読むため、
// setupEnv() で環境変数を設定したあとに動的 import する。checks/report の import も
// --dry-run の後（実際に使う直前）に動的 import し、--dry-run はそれらに依存しないようにする。
// -------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { estimateCost, loadEstimates, loadPricing, type CostEstimateResult, type CostPlanItem } from "./cost.js";
import { createFakeDynamo } from "./fakeDynamo.js";
import { executeRun, type ProductionModules } from "./execute.js";
import { loadScenarios, resolveScenarioDatetimes } from "./scenarios.js";
import { TARGET_FUNCTIONS, type ModelEntry, type RunResult, type RunSummary, type Scenario, type TargetFunction } from "./types.js";

// このファイルは esbuild で api/test/ai-response/.build/cli.mjs にバンドルされて実行される。
const here = path.dirname(fileURLToPath(import.meta.url));
// .build -> ai-response -> test -> api
const API_DIR = path.resolve(here, "../../../");
const AI_RESPONSE_DIR = path.resolve(here, "../");
const DEFAULT_CONTENT_DIR = path.join(API_DIR, "content");
const RESULTS_DIR = path.join(AI_RESPONSE_DIR, "results");
const BASELINE_DIR = path.join(AI_RESPONSE_DIR, "baseline");
const MODELS_JSON_PATH = path.join(AI_RESPONSE_DIR, "models.json");

// -------------------------------------------------------
// CLI 引数
// -------------------------------------------------------

interface CliArgs {
  functions: TargetFunction[];
  models: string[];
  scenarioIds?: string[];
  repeat: number;
  concurrency: number;
  maxCostUsd: number;
  dryRun: boolean;
  out: string;
  saveBaseline: boolean;
  compareToBaseline: boolean;
}

function requireValue(argv: string[], index: number, key: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${key} には値が必要です`);
  return value;
}

function timestampForDir(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[], now: Date): CliArgs {
  const args: CliArgs = {
    functions: [...TARGET_FUNCTIONS],
    models: ["nova-lite"],
    scenarioIds: undefined,
    repeat: 3,
    concurrency: 3,
    maxCostUsd: 5,
    dryRun: false,
    out: path.join(RESULTS_DIR, timestampForDir(now)),
    saveBaseline: false,
    compareToBaseline: false,
  };

  const validFunctions = new Set<string>(TARGET_FUNCTIONS);

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    switch (key) {
      case "--functions": {
        const values = requireValue(argv, ++i, key).split(",").map((s) => s.trim());
        for (const v of values) {
          if (!validFunctions.has(v)) throw new Error(`--functions に未知の機能: ${v}`);
        }
        args.functions = values as TargetFunction[];
        break;
      }
      case "--models":
        args.models = requireValue(argv, ++i, key).split(",").map((s) => s.trim());
        break;
      case "--scenarios":
        args.scenarioIds = requireValue(argv, ++i, key).split(",").map((s) => s.trim());
        break;
      case "--repeat":
        args.repeat = Number(requireValue(argv, ++i, key));
        break;
      case "--concurrency":
        args.concurrency = Number(requireValue(argv, ++i, key));
        break;
      case "--max-cost":
        args.maxCostUsd = Number(requireValue(argv, ++i, key));
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--out":
        args.out = path.resolve(requireValue(argv, ++i, key));
        break;
      case "--save-baseline":
        args.saveBaseline = true;
        break;
      case "--compare-to-baseline":
        args.compareToBaseline = true;
        break;
      default:
        console.warn(`[cli] 未知の引数を無視します: ${key}`);
    }
  }

  if (!Number.isFinite(args.repeat) || args.repeat < 1) throw new Error("--repeat は1以上の数値で指定してください");
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency は1以上の数値で指定してください");
  }
  if (!Number.isFinite(args.maxCostUsd) || args.maxCostUsd < 0) {
    throw new Error("--max-cost は0以上の数値で指定してください");
  }

  return args;
}

// -------------------------------------------------------
// 環境変数（本番コードを動的 import する前に設定する）
// -------------------------------------------------------

function setupEnv(): void {
  if (!process.env.CONTENT_DIR) process.env.CONTENT_DIR = DEFAULT_CONTENT_DIR;
  if (!process.env.AWS_REGION) process.env.AWS_REGION = "ap-northeast-1";
  // 偽の DynamoDB を使うため、テーブル名は任意の文字列でよい。
  if (!process.env.CONVERSATION_LOGS_TABLE) process.env.CONVERSATION_LOGS_TABLE = "ai-test-conversation-logs";
  if (!process.env.CHARACTER_MEMORY_TABLE) process.env.CHARACTER_MEMORY_TABLE = "ai-test-character-memory";
  if (!process.env.EVENTS_TABLE) process.env.EVENTS_TABLE = "ai-test-events";
}

async function loadProductionModules(): Promise<ProductionModules> {
  const [packagesModule, dynamoModule, absenceSimulatorModule, dialogueGeneratorModule, emotionUpdaterModule, memoryRetrieverModule] =
    await Promise.all([
      import("../../../src/lib/packages.js"),
      import("../../../src/lib/dynamo.js"),
      import("../../../src/absenceSimulator/index.js"),
      import("../../../src/dialogueGenerator/index.js"),
      import("../../../src/emotionUpdater/index.js"),
      import("../../../src/memoryRetriever/index.js"),
    ]);

  return {
    loadPackage: packagesModule.loadPackage,
    DEFAULT_PACKAGE_ID: packagesModule.DEFAULT_PACKAGE_ID,
    dynamo: dynamoModule,
    runAbsenceSimulator: absenceSimulatorModule.runAbsenceSimulator,
    runDialogueGenerator: dialogueGeneratorModule.runDialogueGenerator,
    runEmotionUpdater: emotionUpdaterModule.runEmotionUpdater,
    runMemoryRetriever: memoryRetrieverModule.runMemoryRetriever,
  };
}

// -------------------------------------------------------
// 計画・見積もりの表示
// -------------------------------------------------------

function printPlan(args: CliArgs, scenarios: Scenario[], estimate: CostEstimateResult): void {
  console.log("[cli] === 実行計画 ===");
  console.log(`  functions:   ${args.functions.join(", ")}`);
  console.log(`  models:      ${args.models.join(", ")}`);
  console.log(
    `  scenarios:   ${args.scenarioIds ? args.scenarioIds.join(", ") : "(絞り込みなし)"} (対象 ${scenarios.length} 件)`
  );
  console.log(`  repeat:      ${args.repeat}`);
  console.log(`  concurrency: ${args.concurrency}（同じモデル内）`);
  console.log(`  max-cost:    $${args.maxCostUsd}`);
  console.log(`  out:         ${args.out}`);
  console.log("");
  console.log("[cli] === 見積もり（機能 × モデル） ===");
  for (const row of estimate.rows) {
    const costText = row.estimatedCostUsd === null ? "不明（料金表に無いモデル）" : `$${row.estimatedCostUsd.toFixed(4)}`;
    console.log(`  ${row.function.padEnd(20)} ${row.modelKey.padEnd(20)} calls=${row.calls} ${costText}`);
  }
  console.log(`  合計（料金表にあるモデルのみ）: $${estimate.totalUsd.toFixed(4)}`);
  if (estimate.missingPricingModelIds.length > 0) {
    console.log(`  料金表に無いモデル: ${estimate.missingPricingModelIds.join(", ")}`);
  }
}

// -------------------------------------------------------
// 結果の保存
// -------------------------------------------------------

async function saveResults(outDir: string, results: RunResult[], summary: RunSummary, report: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const jsonl = results.map((r) => JSON.stringify(r)).join("\n") + (results.length > 0 ? "\n" : "");
  await writeFile(path.join(outDir, "runs.jsonl"), jsonl, "utf8");
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "report.md"), report, "utf8");
}

async function saveBaseline(outDir: string): Promise<void> {
  await mkdir(BASELINE_DIR, { recursive: true });
  const summaryRaw = await readFile(path.join(outDir, "summary.json"), "utf8");
  await writeFile(path.join(BASELINE_DIR, "summary.json"), summaryRaw, "utf8");
  console.log(`[cli] 基準を更新しました: ${path.join(BASELINE_DIR, "summary.json")}`);
}

async function tryLoadBaseline(): Promise<RunSummary | undefined> {
  try {
    const raw = await readFile(path.join(BASELINE_DIR, "summary.json"), "utf8");
    return JSON.parse(raw) as RunSummary;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

async function appendToReport(outDir: string, extraMarkdown: string): Promise<void> {
  const reportPath = path.join(outDir, "report.md");
  const current = await readFile(reportPath, "utf8");
  await writeFile(reportPath, `${current}\n\n${extraMarkdown}\n`, "utf8");
}

// -------------------------------------------------------
// メイン
// -------------------------------------------------------

async function main(): Promise<void> {
  const startedAtDate = new Date();
  const args = parseArgs(process.argv.slice(2), startedAtDate);
  setupEnv();

  const modelsRaw = await readFile(MODELS_JSON_PATH, "utf8");
  const models = JSON.parse(modelsRaw) as Record<string, ModelEntry>;
  for (const key of args.models) {
    if (!models[key]) throw new Error(`--models に未知のモデルキー: ${key}（models.json を確認してください）`);
  }

  const [pricing, estimates, allScenarios] = await Promise.all([loadPricing(), loadEstimates(), loadScenarios()]);

  let scenarios = allScenarios.filter((s) => args.functions.includes(s.function));
  if (args.scenarioIds) {
    const wanted = new Set(args.scenarioIds);
    scenarios = scenarios.filter((s) => wanted.has(s.id));
  }

  // シナリオの相対日時は、実行開始時刻を基準に一度だけ解決する（実行と、後段の判定〔checks〕・
  // レポートで同じ絶対時刻を使うため）。
  const resolvedScenarios = scenarios.map((s) => resolveScenarioDatetimes(s, startedAtDate));

  const plan: CostPlanItem[] = [];
  for (const fn of args.functions) {
    const scenarioCount = resolvedScenarios.filter((s) => s.function === fn).length;
    if (scenarioCount === 0) continue;
    for (const modelKey of args.models) {
      plan.push({
        function: fn,
        modelKey,
        modelId: models[modelKey].modelId,
        scenarioCount,
        repeat: args.repeat,
      });
    }
  }

  const estimate = estimateCost(plan, estimates, pricing);
  printPlan(args, resolvedScenarios, estimate);

  if (estimate.totalUsd > args.maxCostUsd) {
    console.error(
      `\n[cli] 見積もり $${estimate.totalUsd.toFixed(4)} が上限 $${args.maxCostUsd} を超えています。実行しません（--max-cost で上限を変更できます）。`
    );
    process.exitCode = 2;
    return;
  }

  if (args.dryRun) {
    console.log("\n[cli] --dry-run のため、ここで終了します（Bedrock は呼んでいません）。");
    return;
  }

  if (resolvedScenarios.length === 0) {
    console.log("[cli] 対象のシナリオがありません。終了します。");
    return;
  }

  const modules = await loadProductionModules();
  const fakeDynamo = createFakeDynamo();
  fakeDynamo.install(modules.dynamo);

  const results: RunResult[] = [];
  let actualCostUsd = 0;
  let budgetExceeded = false;

  for (const modelKey of args.models) {
    if (budgetExceeded) break;
    const modelId = models[modelKey].modelId;

    const jobs: Array<{ scenario: Scenario; repeatIndex: number }> = [];
    for (const scenario of resolvedScenarios) {
      for (let r = 0; r < args.repeat; r++) {
        jobs.push({ scenario, repeatIndex: r });
      }
    }

    let nextJobIndex = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (budgetExceeded) return;
        const jobIndex = nextJobIndex++;
        if (jobIndex >= jobs.length) return;
        const job = jobs[jobIndex];

        const result = await executeRun({
          scenario: job.scenario,
          modelKey,
          modelId,
          repeatIndex: job.repeatIndex,
          fakeDynamo,
          modules,
          pricing,
        });
        results.push(result);

        const costText = result.metrics.costUsd === null ? "不明" : `$${result.metrics.costUsd.toFixed(5)}`;
        console.log(
          `[cli] ${modelKey} ${result.function}/${result.scenarioId} #${result.repeatIndex} ` +
            (result.error ? `ERROR: ${result.error}` : `OK (${result.metrics.totalLatencyMs}ms, ${costText})`)
        );

        if (result.metrics.costUsd !== null) actualCostUsd += result.metrics.costUsd;
        if (actualCostUsd > args.maxCostUsd) {
          console.warn(`[cli] 実際の料金が上限 $${args.maxCostUsd} を超えました。残りの実行を打ち切ります。`);
          budgetExceeded = true;
          return;
        }
      }
    };

    const workerCount = Math.max(1, Math.min(args.concurrency, jobs.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  fakeDynamo.uninstall();

  // 判定・レポートは、--dry-run の分岐より後（実際に使う直前）に動的 import する。
  const { runChecks } = await import("./checks/index.js");

  const scenarioByKey = new Map(resolvedScenarios.map((s) => [`${s.function}::${s.id}`, s] as const));
  const packageCache = new Map<string, Awaited<ReturnType<typeof modules.loadPackage>>>();

  for (const result of results) {
    const scenario = scenarioByKey.get(`${result.function}::${result.scenarioId}`);
    if (!scenario) continue;

    const packageId = scenario.packageId ?? modules.DEFAULT_PACKAGE_ID;
    let pkg = packageCache.get(packageId);
    if (pkg === undefined) {
      pkg = await modules.loadPackage(packageId);
      packageCache.set(packageId, pkg);
    }
    if (!pkg) continue;

    result.checks = runChecks(scenario, result, {
      world: pkg.world,
      character: pkg.character,
      lifestyle: pkg.lifestyle,
      resolvedScenario: scenario,
    });
  }

  const finishedAt = new Date().toISOString();
  const { summarize, renderReport, compareToBaseline } = await import("./report.js");

  const summary = summarize(
    results,
    { functions: args.functions, models: args.models, repeat: args.repeat, maxCostUsd: args.maxCostUsd },
    startedAtDate.toISOString(),
    finishedAt
  );
  const report = renderReport(summary, results, resolvedScenarios);

  await saveResults(args.out, results, summary, report);
  console.log(`\n[cli] 結果を保存しました: ${args.out}`);

  if (args.saveBaseline) {
    await saveBaseline(args.out);
  }

  if (args.compareToBaseline) {
    const baseline = await tryLoadBaseline();
    if (baseline) {
      await appendToReport(args.out, compareToBaseline(summary, baseline));
      console.log("[cli] 基準との比較を report.md に追記しました。");
    } else {
      console.warn("[cli] 基準（baseline/summary.json）が見つかりません。比較をスキップします。");
    }
  }
}

main().catch((e) => {
  console.error("[cli] failed:", e);
  process.exitCode = 1;
});
