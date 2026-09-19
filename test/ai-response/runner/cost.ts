// -------------------------------------------------------
// 料金の計算と、実行前の見積もり
//
// pricing.json（モデルごとの100万トークンあたりの USD）と estimates.json（機能ごとの
// 1回あたりの想定トークン数）を読み、実際の使用量（ModelCallRecord.usage）からの料金計算と、
// 実行前の見積もり（機能×モデルごとの想定トークン数 × シナリオ数 × 繰り返し × 単価）を行う。
// -------------------------------------------------------

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ModelCallRecord, ModelPrice, TargetFunction } from "./types.js";

// test/ai-response/（このファイルは runner/ 配下）
const DEFAULT_PRICING_PATH = path.resolve(fileURLToPath(import.meta.url), "../../pricing.json");
const DEFAULT_ESTIMATES_PATH = path.resolve(fileURLToPath(import.meta.url), "../../estimates.json");

export interface FunctionEstimate {
  inputTokens: number;
  outputTokens: number;
}

export type EstimatesConfig = Record<TargetFunction, FunctionEstimate>;

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/** pricing.json を読み、modelId → 料金 の対応を返す */
export async function loadPricing(pricingPath: string = DEFAULT_PRICING_PATH): Promise<Record<string, ModelPrice>> {
  const data = await readJson<{ models: Record<string, ModelPrice> }>(pricingPath);
  return data.models;
}

/** estimates.json を読み、機能ごとの1回あたりの想定トークン数を返す */
export async function loadEstimates(estimatesPath: string = DEFAULT_ESTIMATES_PATH): Promise<EstimatesConfig> {
  const data = await readJson<{ functions: EstimatesConfig }>(estimatesPath);
  return data.functions;
}

// -------------------------------------------------------
// 実際の使用量からの料金計算
// -------------------------------------------------------

/**
 * 1回の Bedrock 呼び出しの使用量から料金（USD）を計算する。
 * キャッシュの書き込みは5分の単価（price.cacheWrite）で計算する。
 * price が無い（料金表に無いモデル）ときは null。
 */
export function calculateCallCost(usage: ModelCallRecord["usage"], price: ModelPrice | null): number | null {
  if (!price) return null;
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output +
    (usage.cacheReadInputTokens / 1_000_000) * price.cacheRead +
    (usage.cacheWriteInputTokens / 1_000_000) * price.cacheWrite
  );
}

/**
 * 1回の実行（複数回 Bedrock を呼ぶことがある）の合計料金を計算する。
 * いずれか1回でも料金表に無いモデルを呼んでいたら null。
 */
export function calculateRunCost(
  calls: ModelCallRecord[],
  pricing: Record<string, ModelPrice>
): number | null {
  let total = 0;
  for (const call of calls) {
    const price = pricing[call.modelId] ?? null;
    const cost = calculateCallCost(call.usage, price);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

// -------------------------------------------------------
// 実行前の見積もり
// -------------------------------------------------------

export interface CostPlanItem {
  function: TargetFunction;
  modelKey: string;
  modelId: string;
  /** この機能・モデルの組で対象になるシナリオの件数 */
  scenarioCount: number;
  repeat: number;
}

export interface CostEstimateRow extends CostPlanItem {
  /** scenarioCount * repeat */
  calls: number;
  /** null は料金表に無いモデル */
  estimatedCostUsd: number | null;
}

export interface CostEstimateResult {
  rows: CostEstimateRow[];
  /** 料金表にあるモデルの分だけの合計（無いモデルは0として扱う。missingPricingModelIds で分かる） */
  totalUsd: number;
  missingPricingModelIds: string[];
}

/**
 * 実行前の見積もり。機能ごとの1回あたりの想定トークン数（estimates.json）×
 * シナリオ数 × 繰り返し回数 × モデルの単価（pricing.json）で、呼び出し1回あたりの
 * キャッシュなしの料金を見積もる。
 */
export function estimateCost(
  plan: CostPlanItem[],
  estimates: EstimatesConfig,
  pricing: Record<string, ModelPrice>
): CostEstimateResult {
  const rows: CostEstimateRow[] = [];
  const missingPricingModelIds = new Set<string>();
  let totalUsd = 0;

  for (const item of plan) {
    const calls = item.scenarioCount * item.repeat;
    const estimate = estimates[item.function];
    const price = pricing[item.modelId] ?? null;

    let estimatedCostUsd: number | null;
    if (!price) {
      estimatedCostUsd = null;
      missingPricingModelIds.add(item.modelId);
    } else {
      const perCallCostUsd =
        (estimate.inputTokens / 1_000_000) * price.input + (estimate.outputTokens / 1_000_000) * price.output;
      estimatedCostUsd = perCallCostUsd * calls;
      totalUsd += estimatedCostUsd;
    }

    rows.push({ ...item, calls, estimatedCostUsd });
  }

  return { rows, totalUsd, missingPricingModelIds: [...missingPricingModelIds] };
}
