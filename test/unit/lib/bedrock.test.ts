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

describe("invokeModel（systemPromptを配列で渡す場合のプロンプトキャッシュ）", () => {
  it("2層の配列 → 層の間にcachePointが入り、最後の層の後ろには入らない", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel(["固定部", "可変部"], "user message");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([
      { text: "固定部" },
      { cachePoint: { type: "default" } },
      { text: "可変部" },
    ]);
  });

  it("3層の配列 → 層の間2箇所にcachePointが入り、最後の層の後ろには入らない", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel(["固定部", "セッション部", "可変部"], "user message");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([
      { text: "固定部" },
      { cachePoint: { type: "default" } },
      { text: "セッション部" },
      { cachePoint: { type: "default" } },
      { text: "可変部" },
    ]);
  });

  it("空文字列の層を含む配列 → 空の層は捨てられ、cachePointが重ならない", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel(["固定部", "", "可変部"], "user message");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([
      { text: "固定部" },
      { cachePoint: { type: "default" } },
      { text: "可変部" },
    ]);
  });

  it("PROMPT_CACHE_ENABLED=false → cachePointが入らずtextだけ並ぶ", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "false");
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel(["固定部", "セッション部", "可変部"], "user message");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([
      { text: "固定部" },
      { text: "セッション部" },
      { text: "可変部" },
    ]);
  });

  it("5層以上の配列 → cachePointは最大4つまで", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel(["層1", "層2", "層3", "層4", "層5"], "user message");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    const cachePointCount = (command.input.system ?? []).filter(
      (block) => "cachePoint" in block
    ).length;
    expect(cachePointCount).toBe(4);
    expect(command.input.system).toEqual([
      { text: "層1" },
      { cachePoint: { type: "default" } },
      { text: "層2" },
      { cachePoint: { type: "default" } },
      { text: "層3" },
      { cachePoint: { type: "default" } },
      { text: "層4" },
      { cachePoint: { type: "default" } },
      { text: "層5" },
    ]);
  });

  it("invokeModelJsonに配列を渡しても同じsystemになる", async () => {
    const sendSpy = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(['{"ok": true}']) as never
    );

    await invokeModelJson(["固定部", "可変部"], "user message", { ok: false });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.system).toEqual([
      { text: "固定部" },
      { cachePoint: { type: "default" } },
      { text: "可変部" },
    ]);
  });
});

describe("invokeModel（usageのログ出力）", () => {
  it("usageがある応答 → inputTokens・outputTokens・cacheReadInputTokens・cacheWriteInputTokensをログに出す", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      ...mockSendResult(["ok"]),
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cacheReadInputTokens: 80,
        cacheWriteInputTokens: 15,
      },
    } as never);

    await invokeModel("system", "user");

    expect(logSpy).toHaveBeenCalledWith(
      "[bedrock] usage input=100 output=20 cacheRead=80 cacheWrite=15"
    );
  });

  it("usageが無い応答 → cacheRead・cacheWriteを0としてログに出し、例外を投げない", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(["ok"]) as never
    );

    await expect(invokeModel("system", "user")).resolves.toBe("ok");

    expect(logSpy).toHaveBeenCalledWith(
      "[bedrock] usage input=0 output=0 cacheRead=0 cacheWrite=0"
    );
  });
});
