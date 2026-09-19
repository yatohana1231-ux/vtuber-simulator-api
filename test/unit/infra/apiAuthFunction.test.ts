import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  loadHandler,
  is401,
  type CfEvent,
  type CfHeaders,
  type CfRequest,
  type Cf401Response,
} from "./loadApiAuthHandler.js";

const FUNCTION_PATH = fileURLToPath(
  new URL("../../../infra/functions/api-auth.js", import.meta.url)
);

/** テスト用の KVS 値（"salt:hash"）を、関数本体と同じ規則（sha256(salt + ":" + password)）で作る。 */
function makeStoredValue(password: string, salt = "test-salt"): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${salt}:${password}`)
    .digest("hex");
  return `${salt}:${hash}`;
}

function basicAuthHeader(id: string, password: string): string {
  return `Basic ${Buffer.from(`${id}:${password}`, "utf8").toString("base64")}`;
}

function makeEvent(options: {
  method?: string;
  authorization?: string;
  origin?: string;
  xTesterId?: string;
}): CfEvent {
  const headers: CfHeaders = {};
  if (options.authorization !== undefined) {
    headers.authorization = { value: options.authorization };
  }
  if (options.origin !== undefined) {
    headers.origin = { value: options.origin };
  }
  if (options.xTesterId !== undefined) {
    headers["x-tester-id"] = { value: options.xTesterId };
  }
  return {
    request: {
      method: options.method ?? "POST",
      headers,
    },
  };
}

const ALLOWED_ORIGIN = "https://d35a8wyhb727oo.cloudfront.net";
const ALLOWED_ORIGINS = [ALLOWED_ORIGIN, "http://localhost:5173"];

describe("api-auth.js の handler", () => {
  it("OPTIONSメソッド → 資格情報なしでrequestがそのまま返る", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({ method: "OPTIONS" });

    const result = await handler(event);

    expect(result).toBe(event.request);
  });

  it("正しい資格情報 → requestが返り、authorizationヘッダーが消えている", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "correct-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(false);
    expect((result as CfRequest).headers.authorization).toBeUndefined();
  });

  it("パスワードに:を含む正しい資格情報 → 通る", async () => {
    const password = "pass:word:with:colons";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue(password),
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", password),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(false);
    expect((result as CfRequest).headers.authorization).toBeUndefined();
  });

  it("日本語のIDとパスワード(UTF-8でbase64化) → 通る", async () => {
    const id = "テスター1";
    const password = "パスワード123";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      [id]: makeStoredValue(password),
    });
    const event = makeEvent({
      authorization: basicAuthHeader(id, password),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(false);
    expect((result as CfRequest).headers.authorization).toBeUndefined();
  });

  it("パスワードの誤り → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "wrong-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
    expect((result as Cf401Response).statusCode).toBe(401);
  });

  it("未登録のID → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader("unknown-user", "correct-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("Authorizationヘッダーなし → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({});

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("Basic以外の形式 → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: `Bearer ${Buffer.from("tester1:correct-password").toString("base64")}`,
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("base64が壊れている → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    // "###" は base64 として有効な文字を含まず、デコード結果が空文字になる（コロンを含まない）。
    const event = makeEvent({ authorization: "Basic ###" });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("IDが空 → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({
      authorization: `Basic ${Buffer.from(":some-password", "utf8").toString("base64")}`,
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("パスワードが空 → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({
      authorization: `Basic ${Buffer.from("tester1:", "utf8").toString("base64")}`,
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("KVSの値の形式が不正(コロンなし) → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: "malformed-value-without-colon",
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "correct-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("KVSの値の形式が不正(saltが空) → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: ":somehash",
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "correct-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("KVSの値の形式が不正(hashが空) → 401", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: "somesalt:",
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "correct-password"),
    });

    const result = await handler(event);

    expect(is401(result)).toBe(true);
  });

  it("401かつ許可したオリジンから → access-control-allow-originとvaryが付く", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({ origin: ALLOWED_ORIGIN });

    const result = (await handler(event)) as Cf401Response;

    expect(result.statusCode).toBe(401);
    expect(result.headers["access-control-allow-origin"]).toEqual({
      value: ALLOWED_ORIGIN,
    });
    expect(result.headers["vary"]).toEqual({ value: "origin" });
  });

  it("401かつ許可していないオリジンから → CORSヘッダーが付かない", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({ origin: "https://evil.example.com" });

    const result = (await handler(event)) as Cf401Response;

    expect(result.statusCode).toBe(401);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(result.headers["vary"]).toBeUndefined();
  });

  it("401かつoriginヘッダーなし → CORSヘッダーが付かない", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({});

    const result = (await handler(event)) as Cf401Response;

    expect(result.statusCode).toBe(401);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(result.headers["vary"]).toBeUndefined();
  });

  it("401応答にwww-authenticateが付かない", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({ origin: ALLOWED_ORIGIN });

    const result = (await handler(event)) as Cf401Response;

    expect(result.headers["www-authenticate"]).toBeUndefined();
  });

  it("401応答のstatusDescriptionとbodyがJSON形式である", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({});

    const result = (await handler(event)) as Cf401Response;

    expect(result.statusDescription).toBe("Unauthorized");
    expect(result.body.encoding).toBe("text");
    expect(JSON.parse(result.body.data)).toEqual({ error: "unauthorized" });
  });
});

describe("api-auth.js の x-tester-id ヘッダー", () => {
  it("照合成功(ASCIIのID) → x-tester-idが付き、base64urlをデコードするとIDに戻る", async () => {
    const id = "tester1";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      [id]: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader(id, "correct-password"),
    });

    const result = (await handler(event)) as CfRequest;

    expect(is401(result)).toBe(false);
    const headerValue = result.headers["x-tester-id"]?.value;
    expect(headerValue).toBeDefined();
    expect(Buffer.from(headerValue as string, "base64url").toString("utf8")).toBe(
      id
    );
  });

  it("照合成功(日本語のID) → x-tester-idをbase64urlデコードするとIDに戻る", async () => {
    const id = "テスター1";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      [id]: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader(id, "correct-password"),
    });

    const result = (await handler(event)) as CfRequest;

    expect(is401(result)).toBe(false);
    const headerValue = result.headers["x-tester-id"]?.value as string;
    expect(Buffer.from(headerValue, "base64url").toString("utf8")).toBe(id);
  });

  it("照合成功 → クライアントが送った偽のx-tester-idは、照合したIDのbase64urlに置き換わる", async () => {
    const id = "tester1";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      [id]: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader(id, "correct-password"),
      xTesterId: "forged-tester-id",
    });

    const result = (await handler(event)) as CfRequest;

    const headerValue = result.headers["x-tester-id"]?.value as string;
    expect(Buffer.from(headerValue, "base64url").toString("utf8")).toBe(id);
  });

  it("401 → クライアントが送ったx-tester-idは消えている", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {
      tester1: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader("tester1", "wrong-password"),
      xTesterId: "forged-tester-id",
    });

    const result = (await handler(event)) as Cf401Response;

    expect(result.statusCode).toBe(401);
    expect(result.headers["x-tester-id"]).toBeUndefined();
  });

  it("OPTIONS → クライアントが送ったx-tester-idは消えている", async () => {
    const handler = loadHandler(ALLOWED_ORIGINS, {});
    const event = makeEvent({ method: "OPTIONS", xTesterId: "forged-tester-id" });

    const result = (await handler(event)) as CfRequest;

    expect(result.headers["x-tester-id"]).toBeUndefined();
  });

  it("x-tester-idの値に=・+・/が含まれない", async () => {
    // base64にした際に + / = を含みやすいIDを選ぶ。
    const id = "\u0000\u0001\u0002\u0003￿??>>";
    const handler = loadHandler(ALLOWED_ORIGINS, {
      [id]: makeStoredValue("correct-password"),
    });
    const event = makeEvent({
      authorization: basicAuthHeader(id, "correct-password"),
    });

    const result = (await handler(event)) as CfRequest;

    const headerValue = result.headers["x-tester-id"]?.value as string;
    expect(headerValue).toBeDefined();
    expect(headerValue).not.toMatch(/[=+/]/);
    expect(Buffer.from(headerValue, "base64url").toString("utf8")).toBe(id);
  });
});

describe("api-auth.js のファイルサイズ", () => {
  it("CloudFront Functionsの上限(10KB)未満である", () => {
    const size = statSync(FUNCTION_PATH).size;

    expect(size).toBeLessThan(10 * 1024);
  });
});
