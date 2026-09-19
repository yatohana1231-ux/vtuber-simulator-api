import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
  summarizeEventForLog,
} from "../../../src/lib/apiHandler.js";

function makeEvent(body: unknown) {
  return { body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handleApiRequest", () => {
  it("handleがBadRequestErrorを投げる → 400でメッセージがerrorになる", async () => {
    const res = await handleApiRequest(makeEvent({}), async () => {
      throw new BadRequestError("characterId must be a non-empty string");
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "characterId must be a non-empty string",
    });
  });

  it("handleがBadRequestError以外の例外を投げる → 500でerrorName/errorMessageが入る", async () => {
    const res = await handleApiRequest(makeEvent({}), async () => {
      throw new TypeError("boom");
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });

  it("handleが正常に返す → その戻り値がそのまま返る", async () => {
    const res = await handleApiRequest(makeEvent({}), async () =>
      Promise.resolve({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      })
    );

    expect(res).toEqual({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
  });

  it("bodyがJSONとして壊れている → 400 invalid JSON body（F-018）", async () => {
    const handle = vi.fn();

    const res = await handleApiRequest({ body: "{bad" }, handle);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid JSON body" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("base64エンコードされたbodyがJSONとして壊れている → 400 invalid JSON body", async () => {
    const handle = vi.fn();
    const event = {
      body: Buffer.from("{bad", "utf8").toString("base64"),
      isBase64Encoded: true,
    };

    const res = await handleApiRequest(event, handle);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid JSON body" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("base64エンコードされた正しいJSONのbody → デコードしてhandleに渡る", async () => {
    const event = {
      body: Buffer.from(JSON.stringify({ characterId: "c1" }), "utf8").toString(
        "base64"
      ),
      isBase64Encoded: true,
    };

    const res = await handleApiRequest(event, async (body) =>
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: JSON.stringify(body),
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ characterId: "c1" });
  });

  it.each([
    ["null", null],
    ["配列", []],
    ["数値", 123],
    ["文字列", "abc"],
    ["真偽値", true],
  ])(
    "bodyがJSONとしては読めるがオブジェクトでない（%s） → 400 request body must be a JSON object",
    async (_label, value) => {
      const handle = vi.fn();

      const res = await handleApiRequest(makeEvent(value), handle);

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: "request body must be a JSON object",
      });
      expect(handle).not.toHaveBeenCalled();
    }
  );

  it("bodyキーが無いイベント（Lambda直接呼び出し） → イベント自体がオブジェクトとしてhandleに渡る", async () => {
    const event = { characterId: "c1" };

    const res = await handleApiRequest(event, async (body) =>
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: JSON.stringify(body),
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ characterId: "c1" });
  });

  it("handle内部で投げたSyntaxErrorは500のまま（invalid JSON bodyに変換されるのはparseRequestBody起因のみ）", async () => {
    const res = await handleApiRequest(makeEvent({}), async () => {
      throw new SyntaxError("handle内部のSyntaxError");
    });

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("Failed to generate a response");
    expect(parsed.errorName).toBe("SyntaxError");
    expect(parsed.errorMessage).toBe("handle内部のSyntaxError");
  });

  it("受け取ったeventの要約（秘密を含まない）をログ出力する", async () => {
    const logSpy = vi.spyOn(console, "log");
    const event = {
      httpMethod: "POST",
      path: "/dialogue-generator",
      resource: "/dialogue-generator",
      requestContext: {
        requestId: "req-12345",
        identity: { apiKey: "super-secret-api-key" },
      },
      headers: {
        "x-api-key": "super-secret-api-key",
        Authorization: "Basic dGVzdGVyOnBhc3N3b3Jk",
        "x-tester-id": "dGVzdGVyLWlk",
      },
      multiValueHeaders: {
        "x-api-key": ["super-secret-api-key"],
        Authorization: ["Basic dGVzdGVyOnBhc3N3b3Jk"],
        "x-tester-id": ["dGVzdGVyLWlk"],
      },
      body: JSON.stringify({ characterId: "c1" }),
    };

    await handleApiRequest(event, async () =>
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: "{}",
      })
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedText = logSpy.mock.calls[0].join(" ");

    // 秘密（API キー・Authorization・テスターID）が含まれない
    expect(loggedText).not.toContain("super-secret-api-key");
    expect(loggedText).not.toContain("dGVzdGVyOnBhc3N3b3Jk");
    expect(loggedText).not.toContain("dGVzdGVyLWlk");
    expect(loggedText).not.toContain("x-api-key");
    expect(loggedText).not.toContain("Authorization");
    expect(loggedText).not.toContain("x-tester-id");

    // 秘密を含まない要約の項目は残る
    const summary = JSON.parse(loggedText.replace(/^Received event:\s*/, ""));
    expect(summary).toEqual({
      httpMethod: "POST",
      path: "/dialogue-generator",
      requestId: "req-12345",
      body: event.body,
    });
  });
});

describe("summarizeEventForLog", () => {
  it("headers・multiValueHeaders・requestContext.identityを含まず、httpMethod・path・requestId・bodyだけを返す", () => {
    const event = {
      httpMethod: "POST",
      path: "/absence-simulator",
      headers: {
        "x-api-key": "secret",
        Authorization: "Basic abc",
        "x-tester-id": "id",
      },
      multiValueHeaders: { "x-api-key": ["secret"] },
      requestContext: {
        requestId: "abc-123",
        identity: { apiKey: "secret" },
      },
      body: "{}",
    };

    expect(summarizeEventForLog(event)).toEqual({
      httpMethod: "POST",
      path: "/absence-simulator",
      requestId: "abc-123",
      body: "{}",
    });
  });

  it("pathが無くresourceがある場合はresourceをpathとして使う", () => {
    expect(summarizeEventForLog({ resource: "/dialogue-generator" })).toEqual({
      path: "/dialogue-generator",
    });
  });

  it("requestContextが無い・requestIdが無い場合はrequestIdを含まない", () => {
    expect(summarizeEventForLog({ httpMethod: "POST" })).toEqual({
      httpMethod: "POST",
    });
    expect(summarizeEventForLog({ requestContext: {} })).toEqual({});
  });

  it("eventがオブジェクトでない場合（null・配列・プリミティブ）は空のオブジェクトを返す", () => {
    expect(summarizeEventForLog(null)).toEqual({});
    expect(summarizeEventForLog(undefined)).toEqual({});
    expect(summarizeEventForLog("abc")).toEqual({});
    expect(summarizeEventForLog(123)).toEqual({});
  });
});

describe("requireCharacterId", () => {
  it("characterIdがある → その値を返す", () => {
    expect(requireCharacterId({ characterId: "c1" })).toBe("c1");
  });

  it("characterIdが未指定 → BadRequestError（characterId must be a non-empty string）", () => {
    expect(() => requireCharacterId({})).toThrow(BadRequestError);
    expect(() => requireCharacterId({})).toThrow(
      "characterId must be a non-empty string"
    );
  });

  it("characterIdが空文字 → BadRequestError（characterId must be a non-empty string）", () => {
    expect(() => requireCharacterId({ characterId: "" })).toThrow(BadRequestError);
    expect(() => requireCharacterId({ characterId: "" })).toThrow(
      "characterId must be a non-empty string"
    );
  });

  it("characterIdが数値 → BadRequestError（characterId must be a non-empty string）", () => {
    expect(() => requireCharacterId({ characterId: 12345 })).toThrow(
      BadRequestError
    );
    expect(() => requireCharacterId({ characterId: 12345 })).toThrow(
      "characterId must be a non-empty string"
    );
  });

  it("characterIdがnull → BadRequestError（characterId must be a non-empty string）", () => {
    expect(() => requireCharacterId({ characterId: null })).toThrow(
      BadRequestError
    );
    expect(() => requireCharacterId({ characterId: null })).toThrow(
      "characterId must be a non-empty string"
    );
  });
});

describe("requirePackage", () => {
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)を返す", async () => {
    const pkg = await requirePackage(undefined);

    expect(pkg.id).toBe("yui-modern-tokyo");
    expect(pkg.world.key).toBe("modern-tokyo");
    expect(pkg.character.key).toBe("yui");
  });

  it("存在しないpackageId → BadRequestError", async () => {
    await expect(requirePackage("no-such-package")).rejects.toThrow(BadRequestError);
    await expect(requirePackage("no-such-package")).rejects.toThrow("unknown packageId");
  });
});
