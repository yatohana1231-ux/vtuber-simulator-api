import { describe, it, expect } from "vitest";
import { getTesterIdFromEvent } from "../../../src/lib/testerId.js";

/** UTF-8 文字列を base64url（パディングなし）にエンコードする（テスト用。本体の実装とは独立） */
function encodeBase64Url(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("getTesterIdFromEvent", () => {
  it("ASCII の ID → デコードして返す", () => {
    const event = { headers: { "x-tester-id": encodeBase64Url("tester01") } };

    expect(getTesterIdFromEvent(event)).toBe("tester01");
  });

  it("日本語の ID → デコードして返す", () => {
    const testerId = "テスター一号";
    const event = { headers: { "x-tester-id": encodeBase64Url(testerId) } };

    expect(getTesterIdFromEvent(event)).toBe(testerId);
  });

  it("ヘッダー名が大文字小文字混在（X-Tester-Id） → デコードして返す", () => {
    const event = { headers: { "X-Tester-Id": encodeBase64Url("tester01") } };

    expect(getTesterIdFromEvent(event)).toBe("tester01");
  });

  it("ヘッダー名がすべて大文字（X-TESTER-ID） → デコードして返す", () => {
    const event = { headers: { "X-TESTER-ID": encodeBase64Url("tester01") } };

    expect(getTesterIdFromEvent(event)).toBe("tester01");
  });

  it("headers に x-tester-id が無い → null", () => {
    const event = { headers: { "content-type": "application/json" } };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("event.headers 自体が無い → null", () => {
    const event = {};

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("x-tester-id が空文字 → null", () => {
    const event = { headers: { "x-tester-id": "" } };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("x-tester-id が文字列でない → null", () => {
    const event = { headers: { "x-tester-id": 12345 } };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("x-tester-id がパディング付き base64（'=' を含む） → null", () => {
    // encodeBase64Url はパディングを外すため、パディング付きは base64url として不正な値になる
    const withPadding = Buffer.from("tester01", "utf8").toString("base64"); // "+"/"/"/"=" を含みうる標準base64
    const event = { headers: { "x-tester-id": withPadding } };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("x-tester-id が base64url のアルファベット以外の文字を含む → null", () => {
    const event = { headers: { "x-tester-id": "!!!not-valid!!!" } };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("headers が null → null", () => {
    const event = { headers: null };

    expect(getTesterIdFromEvent(event)).toBeNull();
  });

  it("event が null → null", () => {
    expect(getTesterIdFromEvent(null)).toBeNull();
  });

  it("event がオブジェクトでない → null", () => {
    expect(getTesterIdFromEvent("not an object")).toBeNull();
  });
});
