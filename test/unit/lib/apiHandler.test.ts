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
      throw new BadRequestError("characterId is required");
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "characterId is required" });
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

  it("bodyがJSONとして壊れている → 500になる（現状の挙動）", async () => {
    const handle = vi.fn();

    const res = await handleApiRequest({ body: "{bad" }, handle);

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("Failed to generate a response");
    expect(parsed.errorName).toBe("SyntaxError");
    expect(handle).not.toHaveBeenCalled();
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

  it("characterIdが未指定 → BadRequestError", () => {
    expect(() => requireCharacterId({})).toThrow(BadRequestError);
    expect(() => requireCharacterId({})).toThrow("characterId is required");
  });

  it("characterIdが空文字 → BadRequestError", () => {
    expect(() => requireCharacterId({ characterId: "" })).toThrow(BadRequestError);
    expect(() => requireCharacterId({ characterId: "" })).toThrow(
      "characterId is required"
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
