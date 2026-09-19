// -------------------------------------------------------
// テスターの ID の取得（tester-character-ownership-roadmap フェーズ3a）
//
// API 専用 CloudFront（infra/functions/api-auth.js）は、資格情報の確認に
// 成功したテスターの ID を UTF-8 の base64url（"-"・"_"、パディング "=" なし）に
// エンコードして `x-tester-id` ヘッダーに入れ、オリジン（API Gateway）に送る
// （クライアントが送った同名ヘッダーは、確認より前に必ず消してから入れ直す）。
// ここでは、API Gateway のイベントからそのヘッダーを取り出してデコードする。
// -------------------------------------------------------

/**
 * API Gateway のイベントの headers から `x-tester-id` を取り出し、
 * base64url（UTF-8）をデコードしてテスターの ID を返す。
 * ヘッダー名は大文字小文字を区別しない。
 *
 * 次の場合は null を返す:
 * - event / event.headers が無い、オブジェクトでない
 * - `x-tester-id` ヘッダーが無い、文字列でない、空文字
 * - base64url のデコード結果が空文字
 * - デコード結果を base64url に戻すと元のヘッダー値と一致しない
 *   （パディング "=" を含む、base64url のアルファベット以外の文字を含む等、不正な値）
 */
export function getTesterIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;

  const headers = (event as Record<string, unknown>).headers;
  if (!headers || typeof headers !== "object") return null;

  const headerValue = findHeaderCaseInsensitive(headers as Record<string, unknown>, "x-tester-id");
  if (typeof headerValue !== "string" || headerValue === "") return null;

  return decodeBase64Url(headerValue);
}

/** headers オブジェクトから、大文字小文字を区別せずヘッダーの値を探す */
function findHeaderCaseInsensitive(headers: Record<string, unknown>, name: string): unknown {
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) return headers[key];
  }
  return undefined;
}

/**
 * base64url（"-"・"_"、パディング "=" なし）の文字列を UTF-8 にデコードする。
 * デコード結果が空文字、または value 自体が不正な base64url（デコードしてから
 * 同じ形式で再エンコードした結果が value と一致しない）場合は null を返す。
 */
function decodeBase64Url(value: string): string | null {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  if (decoded === "") return null;

  // Buffer.from(..., "base64") は base64 のアルファベット以外の文字を黙って
  // 無視してしまうため、デコード結果を再度 base64url にエンコードし直し、
  // 元の値と一致するかどうかで不正な文字の混入を検出する。
  if (encodeBase64Url(decoded) !== value) return null;

  return decoded;
}

/** UTF-8 文字列を base64url（パディングなし）にエンコードする */
function encodeBase64Url(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
