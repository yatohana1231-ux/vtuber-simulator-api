// -------------------------------------------------------
// 共通ユーティリティ
// -------------------------------------------------------

/** API Gateway のイベントから body をパースする */
export function parseRequestBody(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const ev = event as Record<string, unknown>;
  if (!("body" in ev)) return ev as Record<string, unknown>;
  if (!ev.body) return {};
  let body = ev.body as string;
  if (ev.isBase64Encoded) {
    body = Buffer.from(body, "base64").toString("utf8");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

/** 数値を 1〜100 にクランプする */
export function clamp(value: number): number {
  return Math.min(100, Math.max(1, Math.round(value)));
}

/** Lambda レスポンスを生成する */
export function createResponse(
  statusCode: number,
  body: unknown
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    },
    body: JSON.stringify(body),
  };
}
