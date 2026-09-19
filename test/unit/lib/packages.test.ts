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

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

describe("loadPackage（本物のapi/content/を読む）", () => {
  it("worldとcharacterが解決される", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(pkg).not.toBeNull();
    expect(pkg?.world.key).toBe("modern-tokyo");
    expect(pkg?.character.key).toBe("yui");
  });

  it("lifestyleとworld.timezoneが解決される", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(pkg?.lifestyle.key).toBe("tokyo-highschool-vtuber");
    expect(pkg?.world.timezone).toBe("Asia/Tokyo");
  });

  it("lifestyle.schedulesのweekday/holidayが1件以上あり、全枠がHH:MM形式になっている", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const { weekday, holiday } = pkg!.lifestyle.schedules;

    expect(weekday.length).toBeGreaterThan(0);
    expect(holiday.length).toBeGreaterThan(0);
    for (const slot of [...weekday, ...holiday]) {
      expect(slot.start).toMatch(HHMM_PATTERN);
      expect(slot.end).toMatch(HHMM_PATTERN);
    }
  });

  it("lifestyle.eventKindsが1件以上ある", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(pkg?.lifestyle.eventKinds.length).toBeGreaterThan(0);
  });

  it("character.initialPerceptionの6軸が読み込まれる", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const perception = pkg?.character.initialPerception;

    expect(perception).toBeDefined();
    for (const key of ["trust", "affection", "respect", "fear", "dependence", "familiarity"] as const) {
      expect(Number.isInteger(perception?.[key])).toBe(true);
      expect(perception?.[key]).toBeGreaterThanOrEqual(1);
      expect(perception?.[key]).toBeLessThanOrEqual(100);
    }
  });

  it("character.relationshipStagesが4段階あり、先頭のpromoteWhenがnull", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const stages = pkg?.character.relationshipStages;

    expect(stages).toHaveLength(4);
    expect(stages?.[0].promoteWhen).toBeNull();
    for (const stage of stages ?? []) {
      expect(stage.key.length).toBeGreaterThan(0);
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.description.length).toBeGreaterThan(0);
      expect(stage.speechStyle.length).toBeGreaterThan(0);
    }
    for (const stage of (stages ?? []).slice(1)) {
      expect(stage.promoteWhen).not.toBeNull();
    }
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
    await mkdir(path.join(tmpDir, "lifestyles"), { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  /** initialPerceptionの検証を通る、6軸すべて有効な値 */
  const VALID_INITIAL_PERCEPTION = {
    trust: 50,
    affection: 50,
    respect: 50,
    fear: 10,
    dependence: 10,
    familiarity: 50,
  };

  /** relationshipStagesの検証を通る、先頭1段階（promoteWhenがnull）だけの最小構成 */
  const VALID_RELATIONSHIP_STAGES = [
    {
      key: "first",
      label: "はじめまして",
      description: "テスト用の説明",
      speechStyle: "テスト用の話し方",
      speechExamples: [],
      promoteWhen: null,
    },
  ];

  /** 最小構成の有効なキャラクター（characters/test-character.json）を書き込む。overridesで一部を上書きできる */
  async function writeCharacter(overrides: Record<string, unknown> = {}) {
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
        initialPerception: VALID_INITIAL_PERCEPTION,
        relationshipStages: VALID_RELATIONSHIP_STAGES,
        ...overrides,
      })
    );
  }

  async function writeMinimalWorldAndCharacter() {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "テスト用",
        rules: [],
        forbiddenElements: [],
        timezone: "Asia/Tokyo",
      })
    );
    await writeCharacter();
  }

  /** 最小構成の有効な生活様式（lifestyles/test-lifestyle.json）を書き込む。overridesで一部を上書きできる */
  async function writeMinimalLifestyle(overrides: Record<string, unknown> = {}) {
    await writeFile(
      path.join(tmpDir, "lifestyles", "test-lifestyle.json"),
      JSON.stringify({
        key: "test-lifestyle",
        schedules: {
          weekday: [{ start: "07:00", end: "08:00", activity: "起床・身支度" }],
          holiday: [{ start: "08:00", end: "09:00", activity: "起床・身支度" }],
        },
        eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
        ...overrides,
      })
    );
  }

  it("speechExamplesが5件に切り詰められる", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "test-pkg.json"),
      JSON.stringify({
        id: "test-pkg",
        displayName: "テストパッケージ",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
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
        timezone: "Asia/Tokyo",
      })
    );
    await writeFile(
      path.join(tmpDir, "packages", "missing-character-pkg.json"),
      JSON.stringify({
        id: "missing-character-pkg",
        displayName: "test",
        world: "test-world",
        character: "no-such-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("missing-character-pkg")).rejects.toThrow();
  });

  it("参照先のlifestyleが存在しない → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeFile(
      path.join(tmpDir, "packages", "missing-lifestyle-pkg.json"),
      JSON.stringify({
        id: "missing-lifestyle-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "no-such-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("missing-lifestyle-pkg")).rejects.toThrow();
  });

  it("world.timezoneが無い → 例外", async () => {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "テスト用",
        rules: [],
        forbiddenElements: [],
        // timezone を持たせない
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
        speechExamples: [],
      })
    );
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "no-timezone-pkg.json"),
      JSON.stringify({
        id: "no-timezone-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("no-timezone-pkg")).rejects.toThrow();
  });

  it("world.timezoneが不正なタイムゾーン文字列 → 例外", async () => {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "テスト用",
        rules: [],
        forbiddenElements: [],
        timezone: "Not/AZone",
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
        speechExamples: [],
      })
    );
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "invalid-timezone-pkg.json"),
      JSON.stringify({
        id: "invalid-timezone-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("invalid-timezone-pkg")).rejects.toThrow();
  });

  it("スケジュール枠のstart/endの形式が不正（例: 7:00） → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle({
      schedules: {
        weekday: [{ start: "7:00", end: "08:00", activity: "起床" }],
        holiday: [],
      },
    });
    await writeFile(
      path.join(tmpDir, "packages", "invalid-slot-format-pkg.json"),
      JSON.stringify({
        id: "invalid-slot-format-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("invalid-slot-format-pkg")).rejects.toThrow();
  });

  it("スケジュール枠のstartとendが同じ → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle({
      schedules: {
        weekday: [{ start: "08:00", end: "08:00", activity: "起床" }],
        holiday: [],
      },
    });
    await writeFile(
      path.join(tmpDir, "packages", "same-start-end-pkg.json"),
      JSON.stringify({
        id: "same-start-end-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("same-start-end-pkg")).rejects.toThrow();
  });

  it("eventKindsが空配列 → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle({ eventKinds: [] });
    await writeFile(
      path.join(tmpDir, "packages", "empty-event-kinds-pkg.json"),
      JSON.stringify({
        id: "empty-event-kinds-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("empty-event-kinds-pkg")).rejects.toThrow();
  });

  it("eventKindsのweightが0以下 → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle({
      eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 0 }],
    });
    await writeFile(
      path.join(tmpDir, "packages", "zero-weight-pkg.json"),
      JSON.stringify({
        id: "zero-weight-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("zero-weight-pkg")).rejects.toThrow();
  });

  it("日をまたぐ枠（23:00→07:00）は受け付ける", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle({
      schedules: {
        weekday: [{ start: "23:00", end: "07:00", activity: "就寝" }],
        holiday: [],
      },
    });
    await writeFile(
      path.join(tmpDir, "packages", "overnight-slot-pkg.json"),
      JSON.stringify({
        id: "overnight-slot-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const pkg = await mod.loadPackage("overnight-slot-pkg");

    expect(pkg?.lifestyle.schedules.weekday).toEqual([
      { start: "23:00", end: "07:00", activity: "就寝" },
    ]);
  });

  /** 有効な世界観・生活様式・パッケージを書き込み、キャラクターだけ overrides で差し替えて読み込む */
  async function loadWithCharacterOverrides(overrides: Record<string, unknown>) {
    await writeFile(
      path.join(tmpDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "テスト用",
        rules: [],
        forbiddenElements: [],
        timezone: "Asia/Tokyo",
      })
    );
    await writeCharacter(overrides);
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "character-validation-pkg.json"),
      JSON.stringify({
        id: "character-validation-pkg",
        displayName: "test",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    return mod.loadPackage("character-validation-pkg");
  }

  it("initialPerceptionの軸が1つ欠けている → 例外", async () => {
    const { familiarity, ...rest } = VALID_INITIAL_PERCEPTION;
    await expect(
      loadWithCharacterOverrides({ initialPerception: rest })
    ).rejects.toThrow();
  });

  it("initialPerceptionの値が範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        initialPerception: { ...VALID_INITIAL_PERCEPTION, trust: 101 },
      })
    ).rejects.toThrow();
  });

  it("initialPerceptionの値が0 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        initialPerception: { ...VALID_INITIAL_PERCEPTION, trust: 0 },
      })
    ).rejects.toThrow();
  });

  it("initialPerceptionの値が整数でない（小数） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        initialPerception: { ...VALID_INITIAL_PERCEPTION, trust: 50.5 },
      })
    ).rejects.toThrow();
  });

  it("relationshipStagesが空配列 → 例外", async () => {
    await expect(loadWithCharacterOverrides({ relationshipStages: [] })).rejects.toThrow();
  });

  it("relationshipStagesのkeyが重複 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [
          { ...VALID_RELATIONSHIP_STAGES[0] },
          {
            key: "first",
            label: "顔なじみ",
            description: "テスト用の説明2",
            speechStyle: "テスト用の話し方2",
            speechExamples: [],
            promoteWhen: { minConversationDays: 1, minConversationCount: 1, minPerception: {} },
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("relationshipStagesの先頭のpromoteWhenがnullでない → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [
          {
            ...VALID_RELATIONSHIP_STAGES[0],
            promoteWhen: { minConversationDays: 0, minConversationCount: 0, minPerception: {} },
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("relationshipStagesの2番目以降にpromoteWhenが無い → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [
          { ...VALID_RELATIONSHIP_STAGES[0] },
          {
            key: "acquainted",
            label: "顔なじみ",
            description: "テスト用の説明2",
            speechStyle: "テスト用の話し方2",
            speechExamples: [],
            promoteWhen: null,
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("relationshipStagesのdescriptionが空文字 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [{ ...VALID_RELATIONSHIP_STAGES[0], description: "" }],
      })
    ).rejects.toThrow();
  });

  it("promoteWhen.minConversationDaysが負の数 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [
          { ...VALID_RELATIONSHIP_STAGES[0] },
          {
            key: "acquainted",
            label: "顔なじみ",
            description: "テスト用の説明2",
            speechStyle: "テスト用の話し方2",
            speechExamples: [],
            promoteWhen: { minConversationDays: -1, minConversationCount: 0, minPerception: {} },
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("promoteWhen.minPerceptionの値が範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: [
          { ...VALID_RELATIONSHIP_STAGES[0] },
          {
            key: "acquainted",
            label: "顔なじみ",
            description: "テスト用の説明2",
            speechStyle: "テスト用の話し方2",
            speechExamples: [],
            promoteWhen: {
              minConversationDays: 0,
              minConversationCount: 0,
              minPerception: { familiarity: 101 },
            },
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("段階のspeechExamplesが5件（MAX_SPEECH_EXAMPLES）に切り詰められる", async () => {
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: [
        {
          ...VALID_RELATIONSHIP_STAGES[0],
          speechExamples: Array.from({ length: 7 }, (_, i) => ({
            player: `段階の質問${i}`,
            reply: `段階の返答${i}`,
          })),
        },
      ],
    });

    expect(pkg?.character.relationshipStages[0].speechExamples).toHaveLength(5);
  });

  it("段階のspeechExamplesを省略 → 空配列として扱う", async () => {
    const { speechExamples, ...stageWithoutExamples } = VALID_RELATIONSHIP_STAGES[0];
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: [stageWithoutExamples],
    });

    expect(pkg?.character.relationshipStages[0].speechExamples).toEqual([]);
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
    await mkdir(path.join(contentDir, "lifestyles"), { recursive: true });
    await writeFile(
      path.join(contentDir, "worlds", "test-world.json"),
      JSON.stringify({
        key: "test-world",
        name: "テスト世界",
        description: "",
        rules: [],
        forbiddenElements: [],
        timezone: "Asia/Tokyo",
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
            label: "はじめまして",
            description: "テスト用の説明",
            speechStyle: "テスト用の話し方",
            speechExamples: [],
            promoteWhen: null,
          },
        ],
      })
    );
    await writeFile(
      path.join(contentDir, "lifestyles", "test-lifestyle.json"),
      JSON.stringify({
        key: "test-lifestyle",
        schedules: {
          weekday: [{ start: "07:00", end: "08:00", activity: "起床・身支度" }],
          holiday: [{ start: "08:00", end: "09:00", activity: "起床・身支度" }],
        },
        eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
      })
    );
    await writeFile(
      path.join(contentDir, "packages", "test-pkg.json"),
      JSON.stringify({
        id: "test-pkg",
        displayName: "テストパッケージ",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
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
