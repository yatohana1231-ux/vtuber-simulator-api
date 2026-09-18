import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { invokeModel, invokeModelJson } from "../../../src/lib/bedrock.js";

function mockSendResult(texts: string[] | undefined) {
  return {
    output:
      texts === undefined
        ? undefined
        : { message: { content: texts.map((text) => ({ text })) } },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("invokeModel", () => {
  it("contentに複数のtextがある → 連結してtrimした文字列を返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(["  こんにちは", "、世界  "]) as never
    );

    const result = await invokeModel("system", "user");

    expect(result).toBe("こんにちは、世界");
  });

  it("outputが無い応答 → 空文字を返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(undefined) as never
    );

    const result = await invokeModel("system", "user");

    expect(result).toBe("");
  });

  it("呼び出す → ConverseCommandのinputにsystemPrompt・userMessage・maxTokensが入っている", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system prompt", "user message", 1234);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([{ text: "system prompt" }]);
    expect(command.input.messages).toEqual([
      { role: "user", content: [{ text: "user message" }] },
    ]);
    expect(command.input.inferenceConfig?.maxTokens).toBe(1234);
  });
});

describe("invokeModelJson", () => {
  const fallback = { ok: false };

  it("```json フェンス付きの応答 → パース結果を返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(['```json\n{"ok": true, "value": 1}\n```']) as never
    );

    const result = await invokeModelJson("system", "user", fallback);

    expect(result).toEqual({ ok: true, value: 1 });
  });

  it("裸の{...}のみの応答 → パース結果を返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(['{"ok": true, "value": 2}']) as never
    );

    const result = await invokeModelJson("system", "user", fallback);

    expect(result).toEqual({ ok: true, value: 2 });
  });

  it("前後に説明文が付いた裸JSON → JSON部分だけをパースして返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult([
        '以下がJSONです。\n{"ok": true, "value": 3}\nよろしくお願いします。',
      ]) as never
    );

    const result = await invokeModelJson("system", "user", fallback);

    expect(result).toEqual({ ok: true, value: 3 });
  });

  it("JSONブロックが無い応答 → fallbackを返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(["JSONではない普通の文章です"]) as never
    );

    const result = await invokeModelJson("system", "user", fallback);

    expect(result).toBe(fallback);
  });

  it("壊れたJSON → fallbackを返す", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(['{"ok": true, "value": }']) as never
    );

    const result = await invokeModelJson("system", "user", fallback);

    expect(result).toBe(fallback);
  });
});
