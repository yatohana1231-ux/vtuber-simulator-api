import { describe, it, expect } from "vitest";
import {
  parseRequestBody,
  clamp,
  createResponse,
} from "../../../src/lib/utils.js";

describe("parseRequestBody", () => {
  it("API Gateway形式（bodyがJSON文字列）を渡す → パース済みのオブジェクトを返す", () => {
    const event = { body: JSON.stringify({ foo: "bar" }) };
    expect(parseRequestBody(event)).toEqual({ foo: "bar" });
  });

  it("isBase64Encoded:trueを渡す → base64をデコードしてからパースする", () => {
    const payload = Buffer.from(JSON.stringify({ foo: "baz" }), "utf8").toString(
      "base64"
    );
    const event = { body: payload, isBase64Encoded: true };
    expect(parseRequestBody(event)).toEqual({ foo: "baz" });
  });

  it("bodyキーを持たないイベントを渡す → イベント自体をそのまま返す", () => {
    const event = { characterId: "abc" };
    expect(parseRequestBody(event)).toEqual({ characterId: "abc" });
  });

  it("bodyが空文字を渡す → 空オブジェクトを返す", () => {
    const event = { body: "" };
    expect(parseRequestBody(event)).toEqual({});
  });

  it("nullを渡す → 空オブジェクトを返す", () => {
    expect(parseRequestBody(null)).toEqual({});
  });

  it("オブジェクトでない値を渡す → 空オブジェクトを返す", () => {
    expect(parseRequestBody("not an object")).toEqual({});
  });
});

describe("clamp", () => {
  it("1〜100の範囲内の値を渡す → そのままの値を返す", () => {
    expect(clamp(50)).toBe(50);
  });

  it("1未満の値を渡す → 1を返す", () => {
    expect(clamp(-10)).toBe(1);
  });

  it("100を超える値を渡す → 100を返す", () => {
    expect(clamp(150)).toBe(100);
  });

  it("小数を渡す → 四捨五入した値を返す", () => {
    expect(clamp(50.5)).toBe(51);
    expect(clamp(50.4)).toBe(50);
  });
});

describe("createResponse", () => {
  it("statusCodeを渡す → レスポンスのstatusCodeに反映される", () => {
    const res = createResponse(400, { error: "bad request" });
    expect(res.statusCode).toBe(400);
  });

  it("レスポンスを生成する → CORSヘッダーが付与される", () => {
    const res = createResponse(200, { ok: true });
    expect(res.headers).toEqual({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    });
  });

  it("bodyにオブジェクトを渡す → JSON文字列化されて格納される", () => {
    const res = createResponse(200, { reply: "こんにちは" });
    expect(res.body).toBe(JSON.stringify({ reply: "こんにちは" }));
  });
});
