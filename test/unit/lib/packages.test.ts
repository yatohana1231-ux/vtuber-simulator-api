import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  loadRequestedPackage,
  loadPackage,
  isValidPackageId,
  DEFAULT_PACKAGE_ID,
} from "../../../src/lib/packages.js";

// packages.ts はモジュールレベルの cache を持つため、テストごとに vi.resetModules() して
// 動的 import することで独立性を保つ（本物の content/ を読むテストではキャッシュの影響が
// 出にくいが、一時ディレクトリを使うテストでは特にモジュールを分離する必要がある）。

describe("loadRequestedPackage（本物のapi/content/を読む）", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("packageId省略 → 既定パッケージ(yui-modern-tokyo)を返す", async () => {
    const mod = await import("../../../src/lib/packages.js");
    const pkg = await mod.loadRequestedPackage(undefined);

    expect(pkg).not.toBeNull();
    expect(pkg?.id).toBe(DEFAULT_PACKAGE_ID);
  });

  it("文字列以外のpackageId → null", async () => {
    const mod = await import("../../../src/lib/packages.js");

    expect(await mod.loadRequestedPackage(123)).toBeNull();
    expect(await mod.loadRequestedPackage({})).toBeNull();
    expect(await mod.loadRequestedPackage(null)).toBeNull();
  });

  it("形式不正なID（../x） → null", async () => {
    const mod = await import("../../../src/lib/packages.js");

    expect(await mod.loadRequestedPackage("../x")).toBeNull();
  });

  it("形式不正なID（大文字を含む） → null", async () => {
    const mod = await import("../../../src/lib/packages.js");

    expect(await mod.loadRequestedPackage("Yui-Modern-Tokyo")).toBeNull();
  });

  it("存在しないID → null", async () => {
    const mod = await import("../../../src/lib/packages.js");

    expect(await mod.loadRequestedPackage("no-such-package")).toBeNull();
  });
});

describe("loadPackage（本物のapi/content/を読む）", () => {
  it("worldとcharacterが解決される", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(pkg).not.toBeNull();
    expect(pkg?.world.key).toBe("modern-tokyo");
    expect(pkg?.character.key).toBe("yui");
  });
});

describe("isValidPackageId", () => {
  it("英小文字・数字・ハイフンのみ → true", () => {
    expect(isValidPackageId("yui-modern-tokyo")).toBe(true);
    expect(isValidPackageId("abc123")).toBe(true);
  });

  it("大文字を含む → false", () => {
    expect(isValidPackageId("Yui")).toBe(false);
  });

  it("パストラバーサルを含む → false", () => {
    expect(isValidPackageId("../x")).toBe(false);
  });
});

// -------------------------------------------------------
// 一時ディレクトリを使うテスト（本物の content/ では再現できないケース）
// -------------------------------------------------------

describe("loadPackage（一時ディレクトリのcontentを使う異常系）", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "vtuber-sim-content-"));
    await mkdir(path.join(tmpDir, "packages"), { recursive: true });
    await mkdir(path.join(tmpDir, "worlds"), { recursive: true });
    await mkdir(path.join(tmpDir, "characters"), { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function writeMinimalWorldAndCharacter() {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "テスト用",
        rules: [],
        forbiddenElements: [],
      })
    );
    await writeFile(
      path.join(tmpDir, "characters", "test-character.json"),
      JSON.stringify({
        key: "test-character",
        name: "テストキャラ",
        personality: "",
        speechStyle: "",
        relationship: "",
        background: "",
        speechExamples: Array.from({ length: 7 }, (_, i) => ({
          player: `質問${i}`,
          reply: `返答${i}`,
        })),
      })
    );
  }

  it("speechExamplesが5件に切り詰められる", async () => {
    await writeMinimalWorldAndCharacter();
    await writeFile(
      path.join(tmpDir, "packages", "test-pkg.json"),
      JSON.stringify({
        id: "test-pkg",
        displayName: "テストパッケージ",
        world: "test-world",
        character: "test-character",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const pkg = await mod.loadPackage("test-pkg");

    expect(pkg?.character.speechExamples).toHaveLength(5);
  });

  it("参照先のworldが存在しない → 例外", async () => {
    await writeFile(
      path.join(tmpDir, "characters", "test-character.json"),
      JSON.stringify({
        key: "test-character",
        name: "テストキャラ",
        personality: "",
        speechStyle: "",
        relationship: "",
        background: "",
        speechExamples: [],
      })
    );
    await writeFile(
      path.join(tmpDir, "packages", "missing-world-pkg.json"),
      JSON.stringify({
        id: "missing-world-pkg",
        displayName: "test",
        world: "no-such-world",
        character: "test-character",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("missing-world-pkg")).rejects.toThrow();
  });

  it("参照先のcharacterが存在しない → 例外", async () => {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "",
        rules: [],
        forbiddenElements: [],
      })
    );
    await writeFile(
      path.join(tmpDir, "packages", "missing-character-pkg.json"),
      JSON.stringify({
        id: "missing-character-pkg",
        displayName: "test",
        world: "test-world",
        character: "no-such-character",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("missing-character-pkg")).rejects.toThrow();
  });

  it("CONTENT_DIRもLAMBDA_TASK_ROOTも無い → 例外", async () => {
    vi.stubEnv("CONTENT_DIR", undefined);
    vi.stubEnv("LAMBDA_TASK_ROOT", undefined);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage(DEFAULT_PACKAGE_ID)).rejects.toThrow(
      "CONTENT_DIR or LAMBDA_TASK_ROOT must be set to locate content files"
    );
  });

  it("LAMBDA_TASK_ROOTのみ設定 → <LAMBDA_TASK_ROOT>/content配下を読む", async () => {
    // LAMBDA_TASK_ROOT/content 配下に最小構成を作る
    const taskRoot = await mkdtemp(path.join(tmpdir(), "vtuber-sim-lambda-"));
    const contentDir = path.join(taskRoot, "content");
    await mkdir(path.join(contentDir, "packages"), { recursive: true });
    await mkdir(path.join(contentDir, "worlds"), { recursive: true });
    await mkdir(path.join(contentDir, "characters"), { recursive: true });
    await writeFile(
      path.join(contentDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "",
        rules: [],
        forbiddenElements: [],
      })
    );
    await writeFile(
      path.join(contentDir, "characters", "test-character.json"),
      JSON.stringify({
        key: "test-character",
        name: "テストキャラ",
        personality: "",
        speechStyle: "",
        relationship: "",
        background: "",
        speechExamples: [],
      })
    );
    await writeFile(
      path.join(contentDir, "packages", "test-pkg.json"),
      JSON.stringify({
        id: "test-pkg",
        displayName: "テストパッケージ",
        world: "test-world",
        character: "test-character",
      })
    );

    vi.stubEnv("CONTENT_DIR", undefined);
    vi.stubEnv("LAMBDA_TASK_ROOT", taskRoot);

    try {
      const mod = await import("../../../src/lib/packages.js");
      const pkg = await mod.loadPackage("test-pkg");

      expect(pkg?.world.key).toBe("test-world");
      expect(pkg?.character.key).toBe("test-character");
    } finally {
      await rm(taskRoot, { recursive: true, force: true });
    }
  });
});
