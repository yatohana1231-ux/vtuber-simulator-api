import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  BadRequestError,
  handleApiRequest,
  requireCharacterId,
  requirePackage,
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

  it("受け取ったeventをログ出力する", async () => {
    const logSpy = vi.spyOn(console, "log");
    const event = makeEvent({ characterId: "c1" });

    await handleApiRequest(event, async () =>
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: "{}",
      })
    );

    expect(logSpy).toHaveBeenCalledWith("Received event:", JSON.stringify(event));
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
