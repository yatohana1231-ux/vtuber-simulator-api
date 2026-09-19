import {
  BedrockRuntimeClient,
  ConverseCommand,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { getModelProfile } from "./modelProfiles.js";

// -------------------------------------------------------
// クライアント
// -------------------------------------------------------

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});

export const DEFAULT_MODEL_ID = "apac.amazon.nova-lite-v1:0";

/**
 * 呼び出しごとに使うモデル ID を決める。
 * 優先順位: 呼び出し元が渡した override（`InvokeModelOptions.modelId`）
 * → 環境変数 `BEDROCK_MODEL_ID`（呼び出し時点の値を読む。モジュール読み込み時に固定しない）
 * → 既定値 `DEFAULT_MODEL_ID`。
 */
export function resolveModelId(override?: string): string {
  return override ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
}

// Bedrock の明示のキャッシュ区切り（cachePoint）は1リクエストに最大4つまで（D-017）。
const MAX_CACHE_POINTS = 4;

// -------------------------------------------------------
// システムプロンプトの組み立て（プロンプトキャッシュ、D-017）
// -------------------------------------------------------

/**
 * systemPrompt（文字列 or 層ごとの文字列の配列）を、Converse API の system フィールドに変換する。
 *
 * - 文字列1つのときは `[{ text: systemPrompt }]`（従来どおり）。
 * - 配列（変わる頻度ごとの層。例: [固定部, 可変部] や [固定部, セッション部, 可変部]）のときは、
 *   空文字列の層を捨てたうえで、層と層の間に `cachePoint` を挟む
 *   （`層1のtext, cachePoint, 層2のtext, cachePoint, ..., 最後の層のtext`。最後の層の後ろには置かない）。
 * - `cachePoint` を挟められるのは最大 `MAX_CACHE_POINTS`（Bedrock の仕様）まで。
 *   それを超える層が渡された場合、先頭からその数だけ区切りを置き、残りは text だけを並べる。
 * - 環境変数 `PROMPT_CACHE_ENABLED` が `"false"` のときは cachePoint を入れず、
 *   層を順に text ブロックとして並べるだけにする（明示のキャッシュに対応していないモデルに切り替える場合のため）。
 */
function buildSystemBlocks(systemPrompt: string | string[]): SystemContentBlock[] {
  const layers = Array.isArray(systemPrompt)
    ? systemPrompt.filter((layer) => layer !== "")
    : [systemPrompt];

  const cacheEnabled = process.env.PROMPT_CACHE_ENABLED !== "false";

  const blocks: SystemContentBlock[] = [];
  layers.forEach((layer, index) => {
    blocks.push({ text: layer });
    const isLast = index === layers.length - 1;
    if (cacheEnabled && !isLast && index < MAX_CACHE_POINTS) {
      blocks.push({ cachePoint: { type: "default" } });
    }
  });

  return blocks;
}

function logSystemPrompt(systemPrompt: string | string[]): void {
  if (!Array.isArray(systemPrompt)) {
    console.log("[bedrock] === systemPrompt ===");
    console.log(systemPrompt);
    return;
  }

  systemPrompt.forEach((layer, index) => {
    console.log(`[bedrock] === systemPrompt layer ${index + 1}/${systemPrompt.length} ===`);
    console.log(layer);
  });
}

// -------------------------------------------------------
// Converse API ラッパー
// -------------------------------------------------------

export interface InvokeModelOptions {
  /**
   * このリクエストだけで使うモデル ID。省略時は環境変数 `BEDROCK_MODEL_ID`、
   * それも無ければ `DEFAULT_MODEL_ID`（`resolveModelId` 参照）。
   */
  modelId?: string;
  /**
   * このリクエストだけで使う temperature。省略時は 0.8（既定の挙動を変えない）。
   * AI 応答テストの LLM 採点（`api/test/ai-response/runner/judge.ts`）など、
   * 出力のばらつきを抑えたい呼び出しのために指定できる。
   */
  temperature?: number;
}

/**
 * Bedrock Converse API を呼び出してテキストを返す汎用関数。
 * systemPrompt を system フィールドに、userMessage を messages に渡す。
 *
 * systemPrompt は文字列1つ、または変わる頻度ごとの層の配列（[固定部, セッション部, 可変部] など、
 * 変わりにくいものから順に並べる）で渡せる。配列で渡した場合、層の境目に Bedrock のプロンプトキャッシュの
 * 区切り（cachePoint）を入れる（D-017）。区切りを入れるかどうかは環境変数 `PROMPT_CACHE_ENABLED`
 * （既定は有効、`"false"` で無効）で切り替えられる。
 *
 * モデル ID は呼び出しごとに `resolveModelId(options.modelId)` で決める
 * （options.modelId → 環境変数 `BEDROCK_MODEL_ID` → `DEFAULT_MODEL_ID` の順）。
 * `inferenceConfig` は `temperature: options.temperature ?? 0.8` を常に渡し、`topP: 0.9` は
 * モデルが対応する場合（`getModelProfile` が `supportsTopP: true` を返す場合）だけ足す。
 */
export async function invokeModel(
  systemPrompt: string | string[],
  userMessage: string,
  maxTokens = 1000,
  options: InvokeModelOptions = {}
): Promise<string> {
  logSystemPrompt(systemPrompt);
  console.log("[bedrock] === userMessage ===");
  console.log(userMessage);
  console.log("[bedrock] === end ===");

  const modelId = resolveModelId(options.modelId);
  const { supportsTopP } = getModelProfile(modelId);

  const command = new ConverseCommand({
    modelId,
    system: buildSystemBlocks(systemPrompt),
    messages: [
      {
        role: "user",
        content: [{ text: userMessage }],
      },
    ],
    inferenceConfig: {
      maxTokens,
      temperature: options.temperature ?? 0.8,
      ...(supportsTopP ? { topP: 0.9 } : {}),
    },
  });

  const result = await bedrockClient.send(command);

  const usage = result.usage;
  console.log(
    `[bedrock] usage model=${modelId} input=${usage?.inputTokens ?? 0} output=${usage?.outputTokens ?? 0} ` +
      `cacheRead=${usage?.cacheReadInputTokens ?? 0} cacheWrite=${usage?.cacheWriteInputTokens ?? 0}`
  );

  const raw =
    result.output?.message?.content
      ?.map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

  return raw;
}

/**
 * JSON レスポンスを期待する Bedrock 呼び出し。
 * モデル出力から最初の JSON ブロックをパースして返す。
 * パース失敗時は fallback を返す。
 *
 * systemPrompt・options は `invokeModel` と同様（options.modelId でモデル ID を上書きできる）。
 */
export async function invokeModelJson<T>(
  systemPrompt: string | string[],
  userMessage: string,
  fallback: T,
  maxTokens = 2000,
  options: InvokeModelOptions = {}
): Promise<T> {
  const raw = await invokeModel(systemPrompt, userMessage, maxTokens, options);

  // ```json ... ``` または { ... } を抽出
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    console.warn("[invokeModelJson] JSON block not found in response. raw:", raw);
    return fallback;
  }

  try {
    return JSON.parse(jsonMatch[1].trim()) as T;
  } catch (e) {
    console.warn("[invokeModelJson] JSON parse failed:", (e as Error).message, "\nraw:", raw);
    return fallback;
  }
}
