import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/testerCharacters/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/testerCharacters/index.js")>();
  return {
    ...actual,
    runListTesterCharacters: vi.fn(),
    runCreateTesterCharacter: vi.fn(),
  };
});

import { handler } from "../../../src/handlers/testerCharacters.js";
import {
  runListTesterCharacters,
  runCreateTesterCharacter,
  TesterCharacterInputError,
  TesterCharacterLimitError,
} from "../../../src/testerCharacters/index.js";

type LambdaResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const mockedList = vi.mocked(runListTesterCharacters);
const mockedCreate = vi.mocked(runCreateTesterCharacter);

/** UTF-8 文字列を base64url（パディングなし）にエンコードする（テスト用。本体の実装とは独立） */
function encodeBase64Url(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeEvent(
  httpMethod: string,
  options: { testerId?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.testerId !== undefined) {
    headers["x-tester-id"] = encodeBase64Url(options.testerId);
  }
  const event: Record<string, unknown> = { httpMethod, headers };
  if (options.body !== undefined) {
    event.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return event;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockedList.mockResolvedValue({ characters: [] });
  mockedCreate.mockResolvedValue({
    characterId: "char-1",
    packageId: "yui-modern-tokyo",
    label: "キャラクター1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

describe("テスターIDの確認", () => {
  it("x-tester-idヘッダーが無い → 403 forbidden、run*は呼ばれない", async () => {
    const res = (await handler(makeEvent("GET"))) as LambdaResponse;

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("x-tester-idが不正なbase64url → 403 forbidden", async () => {
    const event = { httpMethod: "GET", headers: { "x-tester-id": "not-valid-base64url=" } };

    const res = (await handler(event)) as LambdaResponse;

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });
});

describe("GET /characters", () => {
  it("200で一覧を返す", async () => {
    mockedList.mockResolvedValue({
      characters: [
        {
          characterId: "char-1",
          packageId: "yui-modern-tokyo",
          label: "キャラクター1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const res = (await handler(makeEvent("GET", { testerId: "tester-1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(200);
    expect(mockedList).toHaveBeenCalledWith("tester-1");
    expect(JSON.parse(res.body)).toEqual({
      characters: [
        {
          characterId: "char-1",
          packageId: "yui-modern-tokyo",
          label: "キャラクター1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("POST /characters", () => {
  it("201で作成したキャラクターを返す", async () => {
    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: { packageId: "yui-modern-tokyo", label: "ゆい" } })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(201);
    expect(mockedCreate).toHaveBeenCalledWith("tester-1", {
      packageId: "yui-modern-tokyo",
      label: "ゆい",
    });
    expect(JSON.parse(res.body)).toEqual({
      characterId: "char-1",
      packageId: "yui-modern-tokyo",
      label: "キャラクター1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("本文が無い → {} として扱われる", async () => {
    const res = (await handler(makeEvent("POST", { testerId: "tester-1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(201);
    expect(mockedCreate).toHaveBeenCalledWith("tester-1", {
      packageId: undefined,
      label: undefined,
    });
  });

  it("bodyがJSONとして壊れている → 400 invalid JSON body", async () => {
    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: "{bad" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid JSON body" });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("bodyがオブジェクトでない（配列） → 400 request body must be a JSON object", async () => {
    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: "[1,2,3]" })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "request body must be a JSON object" });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("入力エラー（TesterCharacterInputError） → 400", async () => {
    mockedCreate.mockRejectedValue(new TesterCharacterInputError("unknown packageId"));

    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: { packageId: "no-such-package" } })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown packageId" });
  });

  it("上限に達している（TesterCharacterLimitError） → 409 character limit reached", async () => {
    mockedCreate.mockRejectedValue(new TesterCharacterLimitError());

    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: {} })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: "character limit reached" });
  });

  it("その他の例外 → 500でerrorName/errorMessageが入る", async () => {
    mockedCreate.mockRejectedValue(new TypeError("boom"));

    const res = (await handler(
      makeEvent("POST", { testerId: "tester-1", body: {} })
    )) as LambdaResponse;

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: "Failed to generate a response",
      errorName: "TypeError",
      errorMessage: "boom",
    });
  });
});

describe("その他のメソッド", () => {
  it("DELETE → 405", async () => {
    const res = (await handler(makeEvent("DELETE", { testerId: "tester-1" }))) as LambdaResponse;

    expect(res.statusCode).toBe(405);
    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("レスポンスの形", () => {
  it("CORSのヘッダーが含まれる", async () => {
    const res = (await handler(makeEvent("GET", { testerId: "tester-1" }))) as LambdaResponse;

    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("ログ", () => {
  it("x-tester-idヘッダーの値がログに出ない", async () => {
    const logSpy = vi.spyOn(console, "log");

    await handler(makeEvent("GET", { testerId: "secret-tester-id" }));

    const loggedText = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(loggedText).not.toContain("secret-tester-id");
    expect(loggedText).not.toContain(encodeBase64Url("secret-tester-id"));
    expect(loggedText).not.toContain("headers");
  });
});
