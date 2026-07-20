import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

// -------------------------------------------------------
// クライアント
// -------------------------------------------------------

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});

export const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "apac.amazon.nova-lite-v1:0";

// -------------------------------------------------------
// Converse API ラッパー
// -------------------------------------------------------

/**
 * Bedrock Converse API を呼び出してテキストを返す汎用関数。
 * systemPrompt を system フィールドに、userMessage を messages に渡す。
 */
export async function invokeModel(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1000
): Promise<string> {
  console.log("[bedrock] === systemPrompt ===");
  console.log(systemPrompt);
  console.log("[bedrock] === userMessage ===");
  console.log(userMessage);
  console.log("[bedrock] === end ===");

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: userMessage }],
      },
    ],
    inferenceConfig: {
      maxTokens,
      temperature: 0.8,
      topP: 0.9,
    },
  });

  const result = await bedrockClient.send(command);

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
 */
export async function invokeModelJson<T>(
  systemPrompt: string,
  userMessage: string,
  fallback: T,
  maxTokens = 2000
): Promise<T> {
  const raw = await invokeModel(systemPrompt, userMessage, maxTokens);

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
