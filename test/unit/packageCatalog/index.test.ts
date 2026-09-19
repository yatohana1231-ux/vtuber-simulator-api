import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/packages.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/packages.js")>();
  return {
    ...actual,
    listPackageIds: vi.fn(),
    loadPackage: vi.fn(),
  };
});

import { runListPackages } from "../../../src/packageCatalog/index.js";
import { listPackageIds, loadPackage, DEFAULT_PACKAGE_ID } from "../../../src/lib/packages.js";
import type { CharacterPackage } from "../../../src/types.js";

const mockedListPackageIds = vi.mocked(listPackageIds);
const mockedLoadPackage = vi.mocked(loadPackage);

function makePackage(overrides: Partial<CharacterPackage> = {}): CharacterPackage {
  return {
    id: "pkg-a",
    displayName: "パッケージA",
    description: "説明A",
    fixedGreeting: "挨拶A",
    world: {
      key: "world-a",
      name: "世界A",
      description: "",
      rules: [],
      forbiddenElements: [],
      timezone: "Asia/Tokyo",
    },
    character: {
      key: "char-a",
      name: "キャラA",
      personality: "",
      speechStyle: "",
      relationship: "",
      background: "",
      speechExamples: [],
      initialPerception: {
        trust: 50,
        affection: 50,
        respect: 50,
        fear: 10,
        dependence: 10,
        familiarity: 50,
      },
      relationshipStages: [
        {
          key: "first",
          label: "はじめ",
          description: "",
          speechStyle: "",
          speechExamples: [],
          promoteWhen: null,
        },
      ],
    },
    lifestyle: {
      key: "life-a",
      schedules: { weekday: [], holiday: [] },
      eventKinds: [{ key: "k", label: "l", weight: 1 }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runListPackages（lib/packages.jsをモック）", () => {
  it("listPackageIdsの並び順のまま返す", async () => {
    mockedListPackageIds.mockResolvedValue(["pkg-b", "pkg-a"]);
    mockedLoadPackage.mockImplementation(async (id) => {
      if (id === "pkg-a") return makePackage({ id: "pkg-a" });
      if (id === "pkg-b") return makePackage({ id: "pkg-b" });
      return null;
    });

    const result = await runListPackages();

    expect(result.packages.map((p) => p.packageId)).toEqual(["pkg-b", "pkg-a"]);
  });

  it("項目を詰め替える（characterName=character.name、worldName=world.name）", async () => {
    mockedListPackageIds.mockResolvedValue(["pkg-a"]);
    mockedLoadPackage.mockResolvedValue(
      makePackage({
        id: "pkg-a",
        displayName: "表示名A",
        description: "説明A",
        fixedGreeting: "挨拶A",
        world: {
          key: "world-a",
          name: "世界の名前A",
          description: "",
          rules: [],
          forbiddenElements: [],
          timezone: "Asia/Tokyo",
        },
        character: {
          ...makePackage().character,
          name: "キャラの名前A",
        },
      })
    );

    const result = await runListPackages();

    expect(result.packages).toEqual([
      {
        packageId: "pkg-a",
        displayName: "表示名A",
        characterName: "キャラの名前A",
        worldName: "世界の名前A",
        description: "説明A",
        fixedGreeting: "挨拶A",
        isDefault: false,
      },
    ]);
  });

  it("isDefaultはDEFAULT_PACKAGE_IDのパッケージだけtrue", async () => {
    mockedListPackageIds.mockResolvedValue([DEFAULT_PACKAGE_ID, "pkg-other"]);
    mockedLoadPackage.mockImplementation(async (id) => makePackage({ id }));

    const result = await runListPackages();

    expect(result.packages.find((p) => p.packageId === DEFAULT_PACKAGE_ID)?.isDefault).toBe(true);
    expect(result.packages.find((p) => p.packageId === "pkg-other")?.isDefault).toBe(false);
  });

  it("1つが例外 → 一覧から外し、console.errorに出して残りを返す", async () => {
    mockedListPackageIds.mockResolvedValue(["pkg-a", "pkg-broken"]);
    const thrown = new Error("boom");
    mockedLoadPackage.mockImplementation(async (id) => {
      if (id === "pkg-broken") throw thrown;
      return makePackage({ id });
    });

    const result = await runListPackages();

    expect(result.packages.map((p) => p.packageId)).toEqual(["pkg-a"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("pkg-broken"), thrown);
  });

  it("1つがnull → 一覧から外し、console.errorに出して残りを返す", async () => {
    mockedListPackageIds.mockResolvedValue(["pkg-a", "pkg-missing"]);
    mockedLoadPackage.mockImplementation(async (id) => {
      if (id === "pkg-missing") return null;
      return makePackage({ id });
    });

    const result = await runListPackages();

    expect(result.packages.map((p) => p.packageId)).toEqual(["pkg-a"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("pkg-missing"));
  });

  it("全部失敗 → 空配列", async () => {
    mockedListPackageIds.mockResolvedValue(["pkg-a", "pkg-b"]);
    mockedLoadPackage.mockResolvedValue(null);

    const result = await runListPackages();

    expect(result.packages).toEqual([]);
  });

  it("listPackageIds自体の例外は伝播する", async () => {
    mockedListPackageIds.mockRejectedValue(new Error("readdir failed"));

    await expect(runListPackages()).rejects.toThrow("readdir failed");
  });
});

describe("runListPackages（本物のapi/content/を読む）", () => {
  it("既定のパッケージが先頭・isDefault:trueで返る", async () => {
    vi.doUnmock("../../../src/lib/packages.js");
    vi.resetModules();
    const mod = await import("../../../src/packageCatalog/index.js");

    const result = await mod.runListPackages();

    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.packages[0]?.packageId).toBe(DEFAULT_PACKAGE_ID);
    expect(result.packages[0]?.isDefault).toBe(true);
  });
});
