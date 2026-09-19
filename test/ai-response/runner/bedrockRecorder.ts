// -------------------------------------------------------
// Bedrock 呼び出しの記録
//
// @aws-sdk/client-bedrock-runtime の BedrockRuntimeClient.prototype.send をラップし、
// ConverseCommand の入力（modelId、system の text 層、user メッセージ）と応答
// （テキスト、usage）、所要時間、例外を ModelCallRecord として記録してから、元の結果を返す
// （例外は記録してから投げ直す）。src/lib/bedrock.ts は Bedrock のクライアントを自前で
// 1つだけ生成するが、prototype を差し替えるためそのインスタンスの呼び出しも記録される
// （実際に Bedrock を呼ぶのは execute.ts が --dry-run でないときだけ）。
//
// start() / stop() で記録の区切りを付ける。同じモデル内の --concurrency で複数の実行が
// 同時に走るため、AsyncLocalStorage で「今どの実行の呼び出しか」を持つ。start() は各実行の
// 一番最初（最初の await より前）で同期的に呼ぶこと。Node の AsyncLocalStorage は、
// await の継続を「その await に達した時点で有効だったストア」に結び付けるため、他の実行が
// 後から enterWith で書き換えても、すでに始まっている実行の継続には影響しない。
// -------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

import type { ModelCallRecord } from "./types.js";

type SendFn = typeof BedrockRuntimeClient.prototype.send;

const als = new AsyncLocalStorage<ModelCallRecord[]>();

let patched = false;
let originalSend: SendFn | undefined;

function extractSystemTextLayers(system: unknown): string[] {
  if (!Array.isArray(system)) return [];
  return system
    .map((block) => (block && typeof block === "object" && "text" in block ? (block as { text?: unknown }).text : undefined))
    .filter((text): text is string => typeof text === "string");
}

function extractUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .flatMap((message) => {
      const content = (message as { content?: unknown } | undefined)?.content;
      return Array.isArray(content) ? content : [];
    })
    .map((block) => (block && typeof block === "object" && "text" in block ? (block as { text?: unknown }).text ?? "" : ""))
    .join("");
}

function extractResponseText(output: unknown): string {
  const content = (output as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && "text" in block ? (block as { text?: unknown }).text ?? "" : ""))
    .join("");
}

function emptyUsage(): ModelCallRecord["usage"] {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
}

function ensurePatched(): void {
  if (patched) return;

  originalSend = BedrockRuntimeClient.prototype.send;
  const original = originalSend;

  BedrockRuntimeClient.prototype.send = function patchedSend(
    this: BedrockRuntimeClient,
    command: unknown,
    ...rest: unknown[]
  ) {
    // コールバック形式の呼び出し（このプロジェクトでは使わないが、防御的にそのまま素通りさせる）
    const lastArg = rest[rest.length - 1];
    const isCallbackStyle = typeof lastArg === "function";

    const records = als.getStore();
    if (!(command instanceof ConverseCommand) || !records || isCallbackStyle) {
      return (original as (...args: unknown[]) => unknown).apply(this, [command, ...rest]);
    }

    const modelId = command.input.modelId ?? "";
    const systemPrompt = extractSystemTextLayers(command.input.system);
    const userMessage = extractUserMessage(command.input.messages);
    const startedAt = Date.now();

    return (original as (...args: unknown[]) => Promise<unknown>)
      .apply(this, [command, ...rest])
      .then((result) => {
        const latencyMs = Date.now() - startedAt;
        const usage = (result as { usage?: Partial<ModelCallRecord["usage"]> })?.usage ?? {};
        records.push({
          modelId,
          systemPrompt,
          userMessage,
          responseText: extractResponseText((result as { output?: unknown })?.output),
          latencyMs,
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
            cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        const latencyMs = Date.now() - startedAt;
        records.push({
          modelId,
          systemPrompt,
          userMessage,
          responseText: "",
          latencyMs,
          usage: emptyUsage(),
          error: `${(error as Error)?.name ?? "Error"}: ${(error as Error)?.message ?? String(error)}`,
        });
        throw error;
      });
  } as unknown as SendFn;

  patched = true;
}

/** この実行の Bedrock 呼び出しの記録を開始する。実行の一番最初（最初の await より前）で呼ぶこと */
export function start(): void {
  ensurePatched();
  als.enterWith([]);
}

/** この実行で記録された Bedrock 呼び出しを返す */
export function stop(): ModelCallRecord[] {
  return als.getStore() ?? [];
}
