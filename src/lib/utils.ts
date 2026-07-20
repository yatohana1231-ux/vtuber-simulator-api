// -------------------------------------------------------
// 共通ユーティリティ
// -------------------------------------------------------

import type { CharacterProfile } from "../types.js";

/** ISO8601 文字列を JST の表示文字列に変換する */
export function formatDatetimeJST(isoString: string): string {
  if (!isoString) return "（日時不明）";
  const d = new Date(isoString);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

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

/** characterProfile を正規化してデフォルト値を埋める */
export function normalizeProfile(
  profile: Partial<CharacterProfile> | undefined
): CharacterProfile {
  return {
    name: profile?.name ?? "少女",
    personality: profile?.personality ?? "明るく前向き",
    speechStyle: profile?.speechStyle ?? "丁寧語",
    relationship: profile?.relationship ?? "初対面のプロデューサー候補",
  };
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
