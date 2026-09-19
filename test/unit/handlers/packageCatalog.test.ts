import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/packageCatalog/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/packageCatalog/index.js")>();
  return {
    ...actual,
    runListPackages: vi.fn(),
  };
});

import { handler } from "../../../src/handlers/packageCatalog.js";
import { runListPackages } from "../../../src/packageCatalog/index.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedRunListPackages = vi.mocked(runListPackages);

function makeEvent(httpMethod: string | undefined, options: { withTesterId?: boolean } = {}) {
  const event: Record<string, unknown> = {};
  if (httpMethod !== undefined) event.httpMethod = httpMethod;
  if (options.withTesterId) {
    event.headers = { "x-tester-id": "dummy" };
  }
  return event;
}

const samplePackages = {
  packages: [
    {
      packageId: "yui-modern-tokyo",
      displayName: "ゆい（現代東京）",
      characterName: "ゆい",
      worldName: "現代の東京",
      description: "説明",
      fixedGreeting: "暇だったらお話ししない？",
      isDefault: true,
    },
  ],
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedRunListPackages.mockResolvedValue(samplePackages);
});

describe("GET /packages", () => {
  it("200でrunListPackagesの結果を返す", async () => {
    const res = (await handler(makeEvent("GET"))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(mockedRunListPackages).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual(samplePackages);
  });

  it("x-tester-idヘッダーが無くても200になる（テスターによらない）", async () => {
    const res = (await handler(makeEvent("GET"))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
  });

  it("x-tester-idヘッダーがあっても無視して200になる", async () => {
    const res = (await handler(makeEvent("GET", { withTesterId: true }))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
  });
});

describe("その他のメソッド", () => {
  it("POST → 405", async () => {
    const res = (await handler(makeEvent("POST"))) as LambdaResponse;

    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body)).toEqual({ error: "method not allowed" });
    expect(mockedRunListPackages).not.toHaveBeenCalled();
  });

  it("httpMethodが無い → 405", async () => {
    const res = (await handler(makeEvent(undefined))) as LambdaResponse;

    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body)).toEqual({ error: "method not allowed" });
  });
});

describe("例外", () => {
  it("runListPackagesが例外 → 500でerrorName/errorMessageが入る", async () => {
    mockedRunListPackages.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(makeEvent("GET"))) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});

describe("レスポンスの形", () => {
  it("CORSのヘッダーが含まれる", async () => {
    const res = (await handler(makeEvent("GET"))) as LambdaResponse;

    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
