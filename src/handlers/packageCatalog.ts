// -------------------------------------------------------
// Lambda ハンドラー: GET /packages
// エントリーポイント。runListPackages を呼ぶだけの薄いハンドラー。
//
// 他の4本・testerCharacters.ts と違い、テスターの ID（x-tester-id）は見ない。
// パッケージの一覧はテスターによらず内容が変わらないため（誰が呼んでも同じ結果）。
// API キー必須（入口の CloudFront の認証を通った呼び出しだけ許す）は API Gateway 側
// （infra）で掛けるので、ここでは確認しない。
// -------------------------------------------------------

import { summarizeEventForLog } from "../lib/apiHandler.js";
import { createResponse } from "../lib/utils.js";
import { runListPackages } from "../packageCatalog/index.js";

/** イベントの httpMethod を安全に取り出す（無い・文字列でなければ undefined） */
function getHttpMethod(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const method = (event as Record<string, unknown>).httpMethod;
  return typeof method === "string" ? method : undefined;
}

export const handler = async (event: unknown) => {
  console.log("Received event:", JSON.stringify(summarizeEventForLog(event)));

  try {
    const httpMethod = getHttpMethod(event);

    if (httpMethod === "GET") {
      const result = await runListPackages();
      return createResponse(200, result);
    }

    return createResponse(405, { error: "method not allowed" });
  } catch (error) {
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
};
