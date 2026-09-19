import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  invokeModel,
  invokeModelJson,
  resolveModelId,
  DEFAULT_MODEL_ID,
} from "../../../src/lib/bedrock.js";

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

describe("resolveModelId", () => {
  it("overrideを渡す → overrideを返す", () => {
    expect(resolveModelId("some.model-id")).toBe("some.model-id");
  });

  it("overrideが無い → 環境変数BEDROCK_MODEL_IDを返す", () => {
    vi.stubEnv("BEDROCK_MODEL_ID", "env.model-id");
    expect(resolveModelId()).toBe("env.model-id");
  });

  it("overrideも環境変数も無い → DEFAULT_MODEL_IDを返す", () => {
    vi.stubEnv("BEDROCK_MODEL_ID", undefined);
    expect(resolveModelId()).toBe(DEFAULT_MODEL_ID);
  });
});

describe("invokeModel（モデルIDの決定とinferenceConfig）", () => {
  it("optionsのmodelIdがある → それがConverseCommandのmodelIdに使われる", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user", 1000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.modelId).toBe("jp.anthropic.claude-sonnet-4-6");
  });

  it("optionsのmodelIdが無い → 呼び出し時点の環境変数BEDROCK_MODEL_IDが使われる", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    vi.stubEnv("BEDROCK_MODEL_ID", "apac.amazon.nova-pro-v1:0");
    await invokeModel("system", "user");
    expect((sendSpy.mock.calls[0][0] as ConverseCommand).input.modelId).toBe(
      "apac.amazon.nova-pro-v1:0"
    );

    // 途中で環境変数を変えても、モジュール読み込み時ではなく呼び出し時点の値が反映される
    vi.stubEnv("BEDROCK_MODEL_ID", "jp.anthropic.claude-haiku-4-5-20251001-v1:0");
    await invokeModel("system", "user");
    expect((sendSpy.mock.calls[1][0] as ConverseCommand).input.modelId).toBe(
      "jp.anthropic.claude-haiku-4-5-20251001-v1:0"
    );
  });

  it("optionsのmodelIdも環境変数も無い → 既定値が使われる", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);
    vi.stubEnv("BEDROCK_MODEL_ID", undefined);

    await invokeModel("system", "user");

    expect((sendSpy.mock.calls[0][0] as ConverseCommand).input.modelId).toBe(
      DEFAULT_MODEL_ID
    );
  });

  it("Novaのモデル → inferenceConfigにtemperatureとtopPが入る", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user", 1000, {
      modelId: "apac.amazon.nova-lite-v1:0",
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig).toEqual({
      maxTokens: 1000,
      temperature: 0.8,
      topP: 0.9,
    });
  });

  it("Claudeのモデル → inferenceConfigにtemperatureのみ入り、topPは入らない", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user", 1000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig).toEqual({
      maxTokens: 1000,
      temperature: 0.8,
    });
    expect(command.input.inferenceConfig?.topP).toBeUndefined();
  });

  it("optionsのtemperatureがある → inferenceConfig.temperatureに使われる（既定の0.8ではない）", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user", 1000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
      temperature: 0,
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig).toEqual({
      maxTokens: 1000,
      temperature: 0,
    });
  });

  it("optionsのtemperatureが無い → 既定の0.8が使われる", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user");

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig?.temperature).toBe(0.8);
  });

  it("Novaのモデル + optionsのtemperature → temperatureが上書きされ、topPは0.9のまま", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(["ok"]) as never);

    await invokeModel("system", "user", 1000, {
      modelId: "apac.amazon.nova-lite-v1:0",
      temperature: 0.2,
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig).toEqual({
      maxTokens: 1000,
      temperature: 0.2,
      topP: 0.9,
    });
  });
});

describe("invokeModelJson（options.modelIdの受け渡し）", () => {
  it("optionsのmodelIdがinvokeModelに渡る", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(['{"ok": true}']) as never);

    await invokeModelJson("system", "user", { ok: false }, 2000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.modelId).toBe("jp.anthropic.claude-sonnet-4-6");
  });

  it("optionsのtemperatureがinvokeModelに渡る", async () => {
    const sendSpy = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockResolvedValue(mockSendResult(['{"ok": true}']) as never);

    await invokeModelJson("system", "user", { ok: false }, 2000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
      temperature: 0,
    });

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.inferenceConfig?.temperature).toBe(0);
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
      `[bedrock] usage model=${DEFAULT_MODEL_ID} input=100 output=20 cacheRead=80 cacheWrite=15`
    );
  });

  it("usageが無い応答 → cacheRead・cacheWriteを0としてログに出し、例外を投げない", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(["ok"]) as never
    );

    await expect(invokeModel("system", "user")).resolves.toBe("ok");

    expect(logSpy).toHaveBeenCalledWith(
      `[bedrock] usage model=${DEFAULT_MODEL_ID} input=0 output=0 cacheRead=0 cacheWrite=0`
    );
  });

  it("modelIdを指定した呼び出し → usageのログにそのモデルIDが入る", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue(
      mockSendResult(["ok"]) as never
    );

    await invokeModel("system", "user", 1000, {
      modelId: "jp.anthropic.claude-sonnet-4-6",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[bedrock] usage model=jp.anthropic.claude-sonnet-4-6 input=0 output=0 cacheRead=0 cacheWrite=0"
    );
  });
});
