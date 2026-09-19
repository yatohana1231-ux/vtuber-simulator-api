import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import {
  validateTesterId,
  validatePassword,
  createStoredValue,
  generateSalt,
  generatePassword,
  parseArgs,
  readLineFromStdin,
  MAX_TESTER_ID_BYTES,
  MIN_PASSWORD_LENGTH,
} from "../../../scripts/manage-testers.js";
import { loadHandler, is401 } from "../infra/loadApiAuthHandler.js";

function basicAuthHeader(id: string, password: string): string {
  return `Basic ${Buffer.from(`${id}:${password}`, "utf8").toString("base64")}`;
}

const ALLOWED_ORIGINS = ["https://d35a8wyhb727oo.cloudfront.net"];

describe("validateTesterId", () => {
  it("空文字 → エラーになる", () => {
    expect(validateTesterId("")).not.toBeNull();
  });

  it("':' を含む → エラーになる", () => {
    expect(validateTesterId("tester:1")).not.toBeNull();
  });

  it(`UTF-8で${MAX_TESTER_ID_BYTES}バイト超（ASCII） → エラーになる`, () => {
    const id = "a".repeat(MAX_TESTER_ID_BYTES + 1);
    expect(validateTesterId(id)).not.toBeNull();
  });

  it(`UTF-8で${MAX_TESTER_ID_BYTES}バイト以下（ASCII） → エラーにならない`, () => {
    const id = "a".repeat(MAX_TESTER_ID_BYTES);
    expect(validateTesterId(id)).toBeNull();
  });

  it("日本語のIDはUTF-8のバイト数で判定される（文字数ではない） → 512バイト超はエラー", () => {
    // 1文字3バイトの日本語を200文字 = 600バイト（文字数は512未満でもバイト数は超える）
    const id = "あ".repeat(200);
    expect(Buffer.byteLength(id, "utf8")).toBeGreaterThan(MAX_TESTER_ID_BYTES);
    expect(validateTesterId(id)).not.toBeNull();
  });

  it("短い日本語のID → エラーにならない", () => {
    expect(validateTesterId("テスター1")).toBeNull();
  });
});

describe("validatePassword", () => {
  it(`${MIN_PASSWORD_LENGTH - 1}文字 → エラーになる`, () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validatePassword(password)).not.toBeNull();
  });

  it(`${MIN_PASSWORD_LENGTH}文字 → エラーにならない`, () => {
    const password = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validatePassword(password)).toBeNull();
  });
});

describe("createStoredValue", () => {
  it("形式が '32桁hex:64桁hex' である", () => {
    const salt = generateSalt();
    const value = createStoredValue("some-password", salt);
    expect(value).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it("同じsalt・同じpasswordなら決定的に同じ値になる", () => {
    const salt = generateSalt();
    const first = createStoredValue("same-password", salt);
    const second = createStoredValue("same-password", salt);
    expect(first).toBe(second);
  });

  it("同じsaltでもpasswordが違えば異なる値になる", () => {
    const salt = generateSalt();
    const first = createStoredValue("password-a", salt);
    const second = createStoredValue("password-b", salt);
    expect(first).not.toBe(second);
  });
});

describe("generatePassword", () => {
  it("validatePassword を満たす", () => {
    expect(validatePassword(generatePassword())).toBeNull();
  });

  it("20文字・base64urlの文字（英数字・'-'・'_'）だけである", () => {
    const password = generatePassword();
    expect(password).toHaveLength(20);
    expect(password).toMatch(/^[A-Za-z0-9_-]{20}$/);
  });

  it("呼ぶたびに違う値になる", () => {
    const first = generatePassword();
    const second = generatePassword();
    expect(first).not.toBe(second);
  });
});

describe("parseArgs", () => {
  it("add <id> → command/idが読み取れ、stageは既定でstg", () => {
    const parsed = parseArgs(["add", "tester1"]);
    expect(parsed.command).toBe("add");
    expect(parsed.id).toBe("tester1");
    expect(parsed.stage).toBe("stg");
    expect(parsed.help).toBe(false);
  });

  it("remove <id> → command/idが読み取れる", () => {
    const parsed = parseArgs(["remove", "tester1"]);
    expect(parsed.command).toBe("remove");
    expect(parsed.id).toBe("tester1");
  });

  it("list → commandのみでidはundefined", () => {
    const parsed = parseArgs(["list"]);
    expect(parsed.command).toBe("list");
    expect(parsed.id).toBeUndefined();
  });

  it("--stage 指定 → stageに反映される", () => {
    const parsed = parseArgs(["list", "--stage", "prod"]);
    expect(parsed.stage).toBe("prod");
  });

  it("--kvs-arn 指定 → kvsArnに反映される", () => {
    const arn = "arn:aws:cloudfront::123456789012:key-value-store/xxxx";
    const parsed = parseArgs(["list", "--kvs-arn", arn]);
    expect(parsed.kvsArn).toBe(arn);
  });

  it("--help → helpがtrueになる（コマンドが無くても例外にならない）", () => {
    const parsed = parseArgs(["--help"]);
    expect(parsed.help).toBe(true);
  });

  it("add でIDを省略 → 例外", () => {
    expect(() => parseArgs(["add"])).toThrow();
  });

  it("未知のコマンド → 例外", () => {
    expect(() => parseArgs(["destroy", "tester1"])).toThrow();
  });

  it("未知のオプション → 例外", () => {
    expect(() => parseArgs(["list", "--unknown", "x"])).toThrow();
  });

  it("--stage に値が無い → 例外", () => {
    expect(() => parseArgs(["list", "--stage"])).toThrow();
  });

  it("add --generate → generateがtrueになる", () => {
    const parsed = parseArgs(["add", "tester1", "--generate"]);
    expect(parsed.generate).toBe(true);
  });

  it("--generate を指定しない → generateはfalse", () => {
    const parsed = parseArgs(["add", "tester1"]);
    expect(parsed.generate).toBe(false);
  });

  it("remove --generate → 例外（add でのみ有効）", () => {
    expect(() => parseArgs(["remove", "tester1", "--generate"])).toThrow();
  });

  it("list --generate → 例外（add でのみ有効）", () => {
    expect(() => parseArgs(["list", "--generate"])).toThrow();
  });
});

describe("readLineFromStdin", () => {
  it("1行分の入力があるストリームを渡す → その行が改行なしで返る", async () => {
    const result = await readLineFromStdin(Readable.from(["abcdefghijkl\n"]));
    expect(result).toBe("abcdefghijkl");
  });

  it("空の入力ストリームを渡す → 空文字が返る", async () => {
    const result = await readLineFromStdin(Readable.from([]));
    expect(result).toBe("");
  });
});

describe("createStoredValue と api-auth.js の整合性", () => {
  it("createStoredValueで作った値をKVSに入れると、正しいパスワードでhandlerを通る", async () => {
    const salt = generateSalt();
    const password = "correct-password-123";
    const kvsStore = { tester1: createStoredValue(password, salt) };
    const handler = loadHandler(ALLOWED_ORIGINS, kvsStore);

    const result = await handler({
      request: {
        method: "POST",
        headers: {
          authorization: { value: basicAuthHeader("tester1", password) },
        },
      },
    });

    expect(is401(result)).toBe(false);
    expect((result as { headers: Record<string, unknown> }).headers.authorization).toBeUndefined();
  });

  it("createStoredValueで作った値をKVSに入れても、誤ったパスワードでは401になる", async () => {
    const salt = generateSalt();
    const kvsStore = { tester1: createStoredValue("correct-password-123", salt) };
    const handler = loadHandler(ALLOWED_ORIGINS, kvsStore);

    const result = await handler({
      request: {
        method: "POST",
        headers: {
          authorization: { value: basicAuthHeader("tester1", "wrong-password") },
        },
      },
    });

    expect(is401(result)).toBe(true);
  });
});
