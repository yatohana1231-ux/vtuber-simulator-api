import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  calculateCallCost,
  calculateRunCost,
  estimateCost,
  loadEstimates,
  loadPricing,
  type CostPlanItem,
  type EstimatesConfig,
} from "./cost.js";
import type { ModelCallRecord, ModelPrice } from "./types.js";

const PRICE: ModelPrice = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 4 };

function usage(overrides: Partial<ModelCallRecord["usage"]> = {}): ModelCallRecord["usage"] {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, ...overrides };
}

function call(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    modelId: "model-a",
    systemPrompt: [],
    userMessage: "",
    responseText: "",
    latencyMs: 0,
    usage: usage(),
    ...overrides,
  };
}

describe("calculateCallCost", () => {
  it("priceがnull → null", () => {
    expect(calculateCallCost(usage({ inputTokens: 1_000_000 }), null)).toBeNull();
  });

  it("100万トークンあたりの単価どおりに計算する", () => {
    const cost = calculateCallCost(
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 1_000_000, cacheWriteInputTokens: 1_000_000 }),
      PRICE
    );
    expect(cost).toBeCloseTo(1 + 2 + 0.5 + 4);
  });

  it("キャッシュの書き込みは5分の単価（cacheWrite）を使う", () => {
    const cost = calculateCallCost(usage({ cacheWriteInputTokens: 1_000_000 }), PRICE);
    expect(cost).toBeCloseTo(4);
  });

  it("0トークン → 0円", () => {
    expect(calculateCallCost(usage(), PRICE)).toBe(0);
  });
});

describe("calculateRunCost", () => {
  const pricing: Record<string, ModelPrice> = { "model-a": PRICE };

  it("複数回のBedrock呼び出しの合計を計算する", () => {
    const calls = [
      call({ usage: usage({ inputTokens: 1_000_000 }) }),
      call({ usage: usage({ outputTokens: 1_000_000 }) }),
    ];
    expect(calculateRunCost(calls, pricing)).toBeCloseTo(1 + 2);
  });

  it("いずれか1回でも料金表に無いモデル → null", () => {
    const calls = [call({ modelId: "model-a" }), call({ modelId: "unknown-model" })];
    expect(calculateRunCost(calls, pricing)).toBeNull();
  });

  it("呼び出しが無い → 0", () => {
    expect(calculateRunCost([], pricing)).toBe(0);
  });
});

describe("loadPricing / loadEstimates", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai-response-cost-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loadPricing はmodelsの中身を返す", async () => {
    const pricingPath = path.join(dir, "pricing.json");
    await writeFile(pricingPath, JSON.stringify({ models: { "model-a": PRICE } }), "utf8");

    const pricing = await loadPricing(pricingPath);

    expect(pricing["model-a"]).toEqual(PRICE);
  });

  it("loadEstimates はfunctionsの中身を返す", async () => {
    const estimatesPath = path.join(dir, "estimates.json");
    const functions: EstimatesConfig = {
      absenceSimulator: { inputTokens: 1, outputTokens: 2 },
      dialogueGenerator: { inputTokens: 3, outputTokens: 4 },
      emotionUpdater: { inputTokens: 5, outputTokens: 6 },
      memoryRetriever: { inputTokens: 7, outputTokens: 8 },
    };
    await writeFile(estimatesPath, JSON.stringify({ functions }), "utf8");

    const estimates = await loadEstimates(estimatesPath);

    expect(estimates).toEqual(functions);
  });

  it("既定のパス（test/ai-response/pricing.json・estimates.json）を読み込める", async () => {
    const pricing = await loadPricing();
    const estimates = await loadEstimates();

    expect(pricing["apac.amazon.nova-lite-v1:0"]).toBeDefined();
    expect(estimates.absenceSimulator).toEqual({ inputTokens: 1300, outputTokens: 600 });
    expect(estimates.dialogueGenerator).toEqual({ inputTokens: 2000, outputTokens: 60 });
    expect(estimates.emotionUpdater).toEqual({ inputTokens: 1100, outputTokens: 120 });
    expect(estimates.memoryRetriever).toEqual({ inputTokens: 1300, outputTokens: 500 });
  });
});

describe("estimateCost", () => {
  const estimates: EstimatesConfig = {
    absenceSimulator: { inputTokens: 1000, outputTokens: 500 },
    dialogueGenerator: { inputTokens: 2000, outputTokens: 60 },
    emotionUpdater: { inputTokens: 1100, outputTokens: 120 },
    memoryRetriever: { inputTokens: 1300, outputTokens: 500 },
  };
  const pricing: Record<string, ModelPrice> = { "model-a": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };

  it("シナリオ数×繰り返し×単価で見積もる", () => {
    const plan: CostPlanItem[] = [
      { function: "absenceSimulator", modelKey: "a", modelId: "model-a", scenarioCount: 2, repeat: 3 },
    ];

    const result = estimateCost(plan, estimates, pricing);

    // 1回あたり: (1000/1e6)*1 + (500/1e6)*1 = 0.0015、calls = 6
    expect(result.rows[0].calls).toBe(6);
    expect(result.rows[0].estimatedCostUsd).toBeCloseTo(0.0015 * 6);
    expect(result.totalUsd).toBeCloseTo(0.0015 * 6);
    expect(result.missingPricingModelIds).toEqual([]);
  });

  it("料金表に無いモデル → 該当行はnull、missingPricingModelIdsに含まれる", () => {
    const plan: CostPlanItem[] = [
      { function: "dialogueGenerator", modelKey: "x", modelId: "unknown-model", scenarioCount: 1, repeat: 1 },
    ];

    const result = estimateCost(plan, estimates, pricing);

    expect(result.rows[0].estimatedCostUsd).toBeNull();
    expect(result.totalUsd).toBe(0);
    expect(result.missingPricingModelIds).toEqual(["unknown-model"]);
  });
});
