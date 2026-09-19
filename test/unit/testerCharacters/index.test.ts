import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRandomUUID } = vi.hoisted(() => ({ mockRandomUUID: vi.fn() }));
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, randomUUID: mockRandomUUID };
});

vi.mock("../../../src/lib/dynamo.js", () => ({
  listTesterCharacters: vi.fn(),
  createTesterCharacter: vi.fn(),
}));

import {
  runListTesterCharacters,
  runCreateTesterCharacter,
  MAX_CHARACTERS_PER_TESTER,
  TesterCharacterInputError,
  TesterCharacterLimitError,
} from "../../../src/testerCharacters/index.js";
import { listTesterCharacters, createTesterCharacter } from "../../../src/lib/dynamo.js";
import type { TesterCharacter } from "../../../src/types.js";

const mockedList = vi.mocked(listTesterCharacters);
const mockedCreate = vi.mocked(createTesterCharacter);

function testerCharacter(overrides: Partial<TesterCharacter> = {}): TesterCharacter {
  return {
    testerId: "tester-1",
    characterId: "char-1",
    packageId: "yui-modern-tokyo",
    label: "キャラクター1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockedList.mockResolvedValue([]);
  mockedCreate.mockResolvedValue(undefined);
  mockRandomUUID.mockReset();
  mockRandomUUID.mockReturnValue("11111111-1111-1111-1111-111111111111");
});

describe("runListTesterCharacters", () => {
  it("listTesterCharactersの結果からtesterIdを除いた要約を返す", async () => {
    mockedList.mockResolvedValue([
      testerCharacter({ characterId: "char-1", createdAt: "2026-01-01T00:00:00.000Z" }),
      testerCharacter({ characterId: "char-2", createdAt: "2026-01-02T00:00:00.000Z" }),
    ]);

    const result = await runListTesterCharacters("tester-1");

    expect(mockedList).toHaveBeenCalledWith("tester-1");
    expect(result).toEqual({
      characters: [
        {
          characterId: "char-1",
          packageId: "yui-modern-tokyo",
          label: "キャラクター1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          characterId: "char-2",
          packageId: "yui-modern-tokyo",
          label: "キャラクター1",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    for (const c of result.characters) {
      expect(c).not.toHaveProperty("testerId");
    }
  });

  it("0件 → 空配列", async () => {
    mockedList.mockResolvedValue([]);

    const result = await runListTesterCharacters("tester-1");

    expect(result).toEqual({ characters: [] });
  });
});

describe("runCreateTesterCharacter", () => {
  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)が使われる", async () => {
    const result = await runCreateTesterCharacter("tester-1", {});

    expect(result.packageId).toBe("yui-modern-tokyo");
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it("label省略 → 「キャラクター{n}」（nは既存件数+1）になる", async () => {
    mockedList.mockResolvedValue([testerCharacter({ characterId: "char-1" })]);

    const result = await runCreateTesterCharacter("tester-1", {});

    expect(result.label).toBe("キャラクター2");
  });

  it("labelが空文字・空白のみ → 既定の名前になる", async () => {
    mockedList.mockResolvedValue([]);

    const result = await runCreateTesterCharacter("tester-1", { label: "   " });

    expect(result.label).toBe("キャラクター1");
  });

  it("labelの前後の空白を除いて保存する", async () => {
    const result = await runCreateTesterCharacter("tester-1", { label: "  ゆい  " });

    expect(result.label).toBe("ゆい");
  });

  it("labelが31文字 → TesterCharacterInputError", async () => {
    const label = "あ".repeat(31);

    await expect(runCreateTesterCharacter("tester-1", { label })).rejects.toThrow(
      TesterCharacterInputError
    );
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("labelが30文字 → 許容される", async () => {
    const label = "あ".repeat(30);

    const result = await runCreateTesterCharacter("tester-1", { label });

    expect(result.label).toBe(label);
  });

  it("labelが文字列でない（数値） → TesterCharacterInputError", async () => {
    await expect(
      runCreateTesterCharacter("tester-1", { label: 12345 })
    ).rejects.toThrow(TesterCharacterInputError);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("存在しないpackageId → TesterCharacterInputError、createTesterCharacterは呼ばれない", async () => {
    await expect(
      runCreateTesterCharacter("tester-1", { packageId: "no-such-package" })
    ).rejects.toThrow(TesterCharacterInputError);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("形式不正なpackageId（パストラバーサル） → TesterCharacterInputError", async () => {
    await expect(
      runCreateTesterCharacter("tester-1", { packageId: "../x" })
    ).rejects.toThrow(TesterCharacterInputError);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it(`既にMAX_CHARACTERS_PER_TESTER(${MAX_CHARACTERS_PER_TESTER})件 → TesterCharacterLimitError、createTesterCharacterは呼ばれない`, async () => {
    mockedList.mockResolvedValue(
      Array.from({ length: MAX_CHARACTERS_PER_TESTER }, (_, i) =>
        testerCharacter({ characterId: `char-${i}` })
      )
    );

    await expect(runCreateTesterCharacter("tester-1", {})).rejects.toThrow(
      TesterCharacterLimitError
    );
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("characterIdはrandomUUID()で発番する", async () => {
    mockRandomUUID.mockReturnValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    const result = await runCreateTesterCharacter("tester-1", {});

    expect(result.characterId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("条件付き書き込みが失敗（ConditionalCheckFailedException） → 1回だけ発番し直して成功する", async () => {
    mockRandomUUID
      .mockReturnValueOnce("first-id")
      .mockReturnValueOnce("second-id");
    const conditionalError = Object.assign(new Error("conditional check failed"), {
      name: "ConditionalCheckFailedException",
    });
    mockedCreate.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce(undefined);

    const result = await runCreateTesterCharacter("tester-1", {});

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(result.characterId).toBe("second-id");
  });

  it("条件付き書き込みが2回とも失敗 → 例外が伝播する", async () => {
    mockRandomUUID
      .mockReturnValueOnce("first-id")
      .mockReturnValueOnce("second-id");
    const conditionalError = Object.assign(new Error("conditional check failed"), {
      name: "ConditionalCheckFailedException",
    });
    mockedCreate.mockRejectedValue(conditionalError);

    await expect(runCreateTesterCharacter("tester-1", {})).rejects.toBe(conditionalError);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  it("条件付き書き込み以外の例外はそのまま伝播し、発番し直さない", async () => {
    const otherError = new Error("network error");
    mockedCreate.mockRejectedValue(otherError);

    await expect(runCreateTesterCharacter("tester-1", {})).rejects.toBe(otherError);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});
