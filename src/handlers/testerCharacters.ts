// -------------------------------------------------------
// Lambda ハンドラー: GET /characters・POST /characters
// エントリーポイント。テスターの ID を確かめたうえで
// runListTesterCharacters / runCreateTesterCharacter を呼ぶ。
//
// 4本の既存ハンドラー（absenceSimulator など）は POST 専用で
// lib/apiHandler.ts の handleApiRequest（httpMethod を見ない）を共有しているため、
// GET/POST の両方を扱うこのハンドラーは handleApiRequest を使わず、
// summarizeEventForLog によるログの要約だけを共有する（D-030 と同じ方針）。
// -------------------------------------------------------

import { summarizeEventForLog } from "../lib/apiHandler.js";
import { getTesterIdFromEvent } from "../lib/testerId.js";
import { createResponse, parseRequestBody } from "../lib/utils.js";
import {
  runCreateTesterCharacter,
  runListTesterCharacters,
  TesterCharacterInputError,
  TesterCharacterLimitError,
} from "../testerCharacters/index.js";

/** イベントの httpMethod を安全に取り出す（無い・文字列でなければ undefined） */
function getHttpMethod(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const method = (event as Record<string, unknown>).httpMethod;
  return typeof method === "string" ? method : undefined;
}

export const handler = async (event: unknown) => {
  console.log("Received event:", JSON.stringify(summarizeEventForLog(event)));

  try {
    // /characters は常にテスターの ID が必要（入口の CloudFront を通らない呼び出しは拒否する）
    const testerId = getTesterIdFromEvent(event);
    if (testerId === null) {
      return createResponse(403, { error: "forbidden" });
    }

    const httpMethod = getHttpMethod(event);

    if (httpMethod === "GET") {
      const result = await runListTesterCharacters(testerId);
      return createResponse(200, result);
    }

    if (httpMethod === "POST") {
      let parsed: unknown;
      try {
        parsed = parseRequestBody(event);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return createResponse(400, { error: "invalid JSON body" });
        }
        throw error;
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return createResponse(400, { error: "request body must be a JSON object" });
      }
      const body = parsed as Record<string, unknown>;

      const result = await runCreateTesterCharacter(testerId, {
        packageId: body.packageId,
        label: body.label,
      });
      return createResponse(201, result);
    }

    return createResponse(405, { error: "method not allowed" });
  } catch (error) {
    if (error instanceof TesterCharacterInputError) {
      return createResponse(400, { error: error.message });
    }
    if (error instanceof TesterCharacterLimitError) {
      return createResponse(409, { error: error.message });
    }
    console.error(error);
    return createResponse(500, {
      error: "Failed to generate a response",
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });
  }
};
