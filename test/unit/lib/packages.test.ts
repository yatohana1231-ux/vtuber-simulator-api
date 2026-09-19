import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  loadRequestedPackage,
  loadPackage,
  isValidPackageId,
  listPackageIds,
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

  it("character.bigFiveの5項目が読み込まれる（D-040）", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const bigFive = pkg?.character.bigFive;

    expect(bigFive).toBeDefined();
    for (const key of [
      "openness",
      "conscientiousness",
      "extraversion",
      "agreeableness",
      "neuroticism",
    ] as const) {
      expect(typeof bigFive?.[key]).toBe("number");
    }
  });

  it("character.goalsが3件読み込まれ、各要素にkey/description/importanceがある（D-040）", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const goals = pkg?.character.goals;

    expect(goals).toHaveLength(3);
    for (const goal of goals ?? []) {
      expect(goal.key.length).toBeGreaterThan(0);
      expect(goal.description.length).toBeGreaterThan(0);
      expect(goal.importance).toBeGreaterThanOrEqual(1);
      expect(goal.importance).toBeLessThanOrEqual(100);
    }
  });

  it("character.attachmentStyleが読み込まれる（D-040）", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(pkg?.character.attachmentStyle).toBe("secure");
  });

  it("relationshipStages[0].maxPerceptionが読み込まれる（D-040）", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const firstStage = pkg?.character.relationshipStages[0];

    expect(firstStage?.maxPerception).toEqual({
      trust: 50,
      affection: 50,
      respect: 60,
      dependence: 25,
      familiarity: 50,
    });
  });

  it("lifestyle.schedulesの全枠にfatigueChangePerHourが有限の数値で入っている（D-040）", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);
    const { weekday, holiday } = pkg!.lifestyle.schedules;

    for (const slot of [...weekday, ...holiday]) {
      expect(typeof slot.fatigueChangePerHour).toBe("number");
      expect(Number.isFinite(slot.fatigueChangePerHour)).toBe(true);
    }
  });

  it("descriptionとfixedGreetingが空でない文字列として読み込まれる", async () => {
    const pkg = await loadPackage(DEFAULT_PACKAGE_ID);

    expect(typeof pkg?.description).toBe("string");
    expect(pkg?.description.length).toBeGreaterThan(0);
    expect(typeof pkg?.fixedGreeting).toBe("string");
    expect(pkg?.fixedGreeting.length).toBeGreaterThan(0);
  });
});

describe("listPackageIds（本物のapi/content/を読む）", () => {
  it("先頭がDEFAULT_PACKAGE_ID", async () => {
    const ids = await listPackageIds();

    expect(ids[0]).toBe(DEFAULT_PACKAGE_ID);
  });
});

describe("loadPackage（本物のapi/content/のkohaku-modern-fantasy-tokyoを読む）", () => {
  const PACKAGE_ID = "kohaku-modern-fantasy-tokyo";

  it("world/character/lifestyleが解決される", async () => {
    const pkg = await loadPackage(PACKAGE_ID);

    expect(pkg).not.toBeNull();
    expect(pkg?.world.key).toBe("modern-fantasy-tokyo");
    expect(pkg?.character.key).toBe("kohaku");
    expect(pkg?.character.name).toBe("コハク");
    expect(pkg?.lifestyle.key).toBe("tokyo-grad-student-researcher");
    expect(pkg?.world.timezone).toBe("Asia/Tokyo");
  });

  it("loadRequestedPackageでも読み込める", async () => {
    const pkg = await loadRequestedPackage(PACKAGE_ID);

    expect(pkg).not.toBeNull();
    expect(pkg?.id).toBe(PACKAGE_ID);
  });

  it("character.relationshipStagesが4段階あり、key の並びが acquaintance/regular/confidant/special", async () => {
    const pkg = await loadPackage(PACKAGE_ID);
    const stages = pkg?.character.relationshipStages;

    expect(stages).toHaveLength(4);
    expect(stages?.map((stage) => stage.key)).toEqual([
      "acquaintance",
      "regular",
      "confidant",
      "special",
    ]);
    expect(stages?.[0].promoteWhen).toBeNull();
    for (const stage of (stages ?? []).slice(1)) {
      expect(stage.promoteWhen).not.toBeNull();
    }
  });

  it("initialPerceptionの各軸が、先頭の段階のmaxPerception（書いてある軸）以下", async () => {
    const pkg = await loadPackage(PACKAGE_ID);
    const initialPerception = pkg?.character.initialPerception;
    const maxPerception = pkg?.character.relationshipStages[0].maxPerception;

    expect(maxPerception).toBeDefined();
    for (const [key, max] of Object.entries(maxPerception ?? {})) {
      expect(initialPerception?.[key as keyof typeof initialPerception]).toBeLessThanOrEqual(max as number);
    }
  });

  it("character.attachmentStyleがavoidant、bigFiveの5項目が-100〜100の有限の数値、goalsが3件", async () => {
    const pkg = await loadPackage(PACKAGE_ID);

    expect(pkg?.character.attachmentStyle).toBe("avoidant");

    const bigFive = pkg?.character.bigFive;
    expect(bigFive).toBeDefined();
    for (const key of [
      "openness",
      "conscientiousness",
      "extraversion",
      "agreeableness",
      "neuroticism",
    ] as const) {
      expect(Number.isFinite(bigFive?.[key])).toBe(true);
      expect(bigFive?.[key]).toBeGreaterThanOrEqual(-100);
      expect(bigFive?.[key]).toBeLessThanOrEqual(100);
    }

    expect(pkg?.character.goals).toHaveLength(3);
  });

  it("lifestyle.schedulesのweekday/holidayが1件以上あり、全枠がHH:MM形式でfatigueChangePerHourが有限の数値", async () => {
    const pkg = await loadPackage(PACKAGE_ID);
    const { weekday, holiday } = pkg!.lifestyle.schedules;

    expect(weekday.length).toBeGreaterThan(0);
    expect(holiday.length).toBeGreaterThan(0);
    for (const slot of [...weekday, ...holiday]) {
      expect(slot.start).toMatch(HHMM_PATTERN);
      expect(slot.end).toMatch(HHMM_PATTERN);
      expect(Number.isFinite(slot.fatigueChangePerHour)).toBe(true);
    }
  });

  it("world.forbiddenElementsに「魔法」が含まれない（この世界観では魔法が存在するため）", async () => {
    const pkg = await loadPackage(PACKAGE_ID);

    expect(pkg?.world.forbiddenElements).not.toContain("魔法");
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
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
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
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
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
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
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

  it("descriptionが無い → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "no-description-pkg.json"),
      JSON.stringify({
        id: "no-description-pkg",
        displayName: "test",
        fixedGreeting: "テスト用の挨拶",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("no-description-pkg")).rejects.toThrow();
  });

  it("fixedGreetingが空文字 → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "empty-fixed-greeting-pkg.json"),
      JSON.stringify({
        id: "empty-fixed-greeting-pkg",
        displayName: "test",
        description: "テスト用の紹介文",
        fixedGreeting: "",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("empty-fixed-greeting-pkg")).rejects.toThrow();
  });

  it("descriptionが文字列でない → 例外", async () => {
    await writeMinimalWorldAndCharacter();
    await writeMinimalLifestyle();
    await writeFile(
      path.join(tmpDir, "packages", "non-string-description-pkg.json"),
      JSON.stringify({
        id: "non-string-description-pkg",
        displayName: "test",
        description: 123,
        fixedGreeting: "テスト用の挨拶",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");

    await expect(mod.loadPackage("non-string-description-pkg")).rejects.toThrow();
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
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
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

// -------------------------------------------------------
// 感情・関係値のモデル（D-040）で追加した項目の検証
// -------------------------------------------------------

describe("loadPackage（一時ディレクトリのcontentを使う異常系: D-040で追加した項目）", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "vtuber-sim-content-affect-"));
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

  const VALID_INITIAL_PERCEPTION = {
    trust: 30,
    affection: 30,
    respect: 30,
    fear: 10,
    dependence: 10,
    familiarity: 30,
  };

  /** 先頭段階（maxPerception付き）と2番目の段階（promoteWhen.minPerception付き）の2段階構成 */
  function twoStages(overrides: {
    firstMaxPerception?: Record<string, number>;
    secondMinPerception?: Record<string, number>;
  }) {
    return [
      {
        key: "first",
        label: "はじめまして",
        description: "テスト用の説明",
        speechStyle: "テスト用の話し方",
        speechExamples: [],
        promoteWhen: null,
        maxPerception: overrides.firstMaxPerception,
      },
      {
        key: "acquainted",
        label: "顔なじみ",
        description: "テスト用の説明2",
        speechStyle: "テスト用の話し方2",
        speechExamples: [],
        promoteWhen: {
          minConversationDays: 0,
          minConversationCount: 0,
          minPerception: overrides.secondMinPerception ?? {},
        },
      },
    ];
  }

  /** 有効な世界観・生活様式を書き込み、キャラクターを overrides で組み立てて読み込む */
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
        initialPerception: VALID_INITIAL_PERCEPTION,
        relationshipStages: twoStages({}),
        ...overrides,
      })
    );
    await writeFile(
      path.join(tmpDir, "lifestyles", "test-lifestyle.json"),
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
      path.join(tmpDir, "packages", "affect-validation-pkg.json"),
      JSON.stringify({
        id: "affect-validation-pkg",
        displayName: "test",
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    return mod.loadPackage("affect-validation-pkg");
  }

  /** 有効な世界観・キャラクターを書き込み、生活様式を overrides で組み立てて読み込む */
  async function loadWithLifestyleOverrides(scheduleOverrides: Record<string, unknown>) {
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
        initialPerception: VALID_INITIAL_PERCEPTION,
        relationshipStages: twoStages({}),
      })
    );
    await writeFile(
      path.join(tmpDir, "lifestyles", "test-lifestyle.json"),
      JSON.stringify({
        key: "test-lifestyle",
        schedules: {
          weekday: [{ start: "07:00", end: "08:00", activity: "起床・身支度", ...scheduleOverrides }],
          holiday: [],
        },
        eventKinds: [{ key: "daily", label: "日常のひとコマ", weight: 1 }],
      })
    );
    await writeFile(
      path.join(tmpDir, "packages", "lifestyle-validation-pkg.json"),
      JSON.stringify({
        id: "lifestyle-validation-pkg",
        displayName: "test",
        description: "テスト用の紹介文",
        fixedGreeting: "テスト用の挨拶",
        world: "test-world",
        character: "test-character",
        lifestyle: "test-lifestyle",
      })
    );
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    return mod.loadPackage("lifestyle-validation-pkg");
  }

  // --- bigFive ---

  it("bigFiveを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({});

    expect(pkg?.character.bigFive).toBeUndefined();
  });

  it("bigFiveの5項目が範囲内 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      bigFive: { openness: -100, conscientiousness: 0, extraversion: 100, agreeableness: 50, neuroticism: -50 },
    });

    expect(pkg?.character.bigFive).toEqual({
      openness: -100,
      conscientiousness: 0,
      extraversion: 100,
      agreeableness: 50,
      neuroticism: -50,
    });
  });

  it("bigFiveの値が範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        bigFive: { openness: 101, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 },
      })
    ).rejects.toThrow();
  });

  it("bigFiveの項目が1つ欠けている → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        bigFive: { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0 },
      })
    ).rejects.toThrow();
  });

  // --- goals ---

  it("goalsを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({});

    expect(pkg?.character.goals).toBeUndefined();
  });

  it("goalsが妥当 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      goals: [{ key: "g1", description: "目標1", importance: 50 }],
    });

    expect(pkg?.character.goals).toEqual([{ key: "g1", description: "目標1", importance: 50 }]);
  });

  it("goalsのkeyが重複 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        goals: [
          { key: "g1", description: "目標1", importance: 50 },
          { key: "g1", description: "目標2", importance: 30 },
        ],
      })
    ).rejects.toThrow();
  });

  it("goalsのdescriptionが空文字 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        goals: [{ key: "g1", description: "", importance: 50 }],
      })
    ).rejects.toThrow();
  });

  it("goalsのimportanceが範囲外（0） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        goals: [{ key: "g1", description: "目標1", importance: 0 }],
      })
    ).rejects.toThrow();
  });

  it("goalsのimportanceが範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        goals: [{ key: "g1", description: "目標1", importance: 101 }],
      })
    ).rejects.toThrow();
  });

  // --- attachmentStyle ---

  it("attachmentStyleを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({});

    expect(pkg?.character.attachmentStyle).toBeUndefined();
  });

  it.each(["secure", "anxious", "avoidant"] as const)(
    "attachmentStyleが%sのとき → 読み込める",
    async (style) => {
      const pkg = await loadWithCharacterOverrides({ attachmentStyle: style });

      expect(pkg?.character.attachmentStyle).toBe(style);
    }
  );

  it("attachmentStyleが不明な値 → 例外", async () => {
    await expect(loadWithCharacterOverrides({ attachmentStyle: "clingy" })).rejects.toThrow();
  });

  // --- affectTuning ---

  it("affectTuningを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({});

    expect(pkg?.character.affectTuning).toBeUndefined();
  });

  it("affectTuning.moodHomeBaseの3軸が範囲内 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      affectTuning: { moodHomeBase: { pleasure: 10, arousal: -10, dominance: 0 } },
    });

    expect(pkg?.character.affectTuning).toEqual({
      moodHomeBase: { pleasure: 10, arousal: -10, dominance: 0 },
    });
  });

  it("affectTuning.moodHomeBaseの軸が範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        affectTuning: { moodHomeBase: { pleasure: 101, arousal: 0, dominance: 0 } },
      })
    ).rejects.toThrow();
  });

  it("affectTuning.perceptionGainScaleが正の数 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      affectTuning: { perceptionGainScale: 1.5 },
    });

    expect(pkg?.character.affectTuning?.perceptionGainScale).toBe(1.5);
  });

  it("affectTuning.perceptionGainScaleが0以下 → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        affectTuning: { perceptionGainScale: 0 },
      })
    ).rejects.toThrow();
  });

  it("affectTuningに知らないキーがある → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        affectTuning: { unknownKnob: 1 },
      })
    ).rejects.toThrow();
  });

  // --- relationshipStages[].maxPerception ---

  it("maxPerceptionを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: twoStages({ secondMinPerception: { familiarity: 20 } }),
    });

    expect(pkg?.character.relationshipStages[0].maxPerception).toBeUndefined();
  });

  it("maxPerceptionが範囲内 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: twoStages({
        firstMaxPerception: { familiarity: 50 },
        secondMinPerception: { familiarity: 20 },
      }),
    });

    expect(pkg?.character.relationshipStages[0].maxPerception).toEqual({ familiarity: 50 });
  });

  it("maxPerceptionの値が範囲外（101） → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: twoStages({ firstMaxPerception: { familiarity: 101 } }),
      })
    ).rejects.toThrow();
  });

  it("maxPerceptionに知らない軸キーがある → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: twoStages({ firstMaxPerception: { unknownAxis: 50 } }),
      })
    ).rejects.toThrow();
  });

  it("段階Nのmaxperceptionの軸が、段階N+1のpromoteWhen.minPerceptionの同じ軸より低い → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        relationshipStages: twoStages({
          firstMaxPerception: { familiarity: 40 },
          secondMinPerception: { familiarity: 45 },
        }),
      })
    ).rejects.toThrow();
  });

  it("段階Nのmaxperceptionの軸が、段階N+1のpromoteWhen.minPerceptionの同じ軸以上 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: twoStages({
        firstMaxPerception: { familiarity: 45 },
        secondMinPerception: { familiarity: 45 },
      }),
    });

    expect(pkg?.character.relationshipStages[0].maxPerception).toEqual({ familiarity: 45 });
  });

  it("段階Nのmaxperceptionに軸を書いていない（上限100とみなす） → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      relationshipStages: twoStages({ secondMinPerception: { familiarity: 90 } }),
    });

    expect(pkg?.character.relationshipStages[0].maxPerception).toBeUndefined();
  });

  // --- initialPerception と最初の段階のmaxPerceptionの整合性 ---

  it("initialPerceptionの軸が最初の段階のmaxPerceptionの同じ軸以下 → 読み込める", async () => {
    const pkg = await loadWithCharacterOverrides({
      initialPerception: { ...VALID_INITIAL_PERCEPTION, familiarity: 30 },
      relationshipStages: twoStages({ firstMaxPerception: { familiarity: 30 } }),
    });

    expect(pkg?.character.initialPerception.familiarity).toBe(30);
  });

  it("initialPerceptionの軸が最初の段階のmaxPerceptionの同じ軸を超える → 例外", async () => {
    await expect(
      loadWithCharacterOverrides({
        initialPerception: { ...VALID_INITIAL_PERCEPTION, familiarity: 31 },
        relationshipStages: twoStages({ firstMaxPerception: { familiarity: 30 } }),
      })
    ).rejects.toThrow();
  });

  // --- lifestyle: ScheduleSlot.fatigueChangePerHour ---

  it("fatigueChangePerHourを省略 → undefinedのまま読み込める", async () => {
    const pkg = await loadWithLifestyleOverrides({});

    expect(pkg?.lifestyle.schedules.weekday[0].fatigueChangePerHour).toBeUndefined();
  });

  it("fatigueChangePerHourが範囲内の数値 → 読み込める", async () => {
    const pkg = await loadWithLifestyleOverrides({ fatigueChangePerHour: -10 });

    expect(pkg?.lifestyle.schedules.weekday[0].fatigueChangePerHour).toBe(-10);
  });

  it("fatigueChangePerHourが範囲外（101） → 例外", async () => {
    await expect(loadWithLifestyleOverrides({ fatigueChangePerHour: 101 })).rejects.toThrow();
  });

  it("fatigueChangePerHourが範囲外（-101） → 例外", async () => {
    await expect(loadWithLifestyleOverrides({ fatigueChangePerHour: -101 })).rejects.toThrow();
  });
});

describe("listPackageIds（一時ディレクトリのcontentを使う）", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "vtuber-sim-content-list-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("DEFAULT_PACKAGE_IDが先頭、残りは昇順で返す", async () => {
    await mkdir(path.join(tmpDir, "packages"), { recursive: true });
    for (const id of ["zeta", "alpha", DEFAULT_PACKAGE_ID]) {
      await writeFile(path.join(tmpDir, "packages", `${id}.json`), "{}");
    }
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const ids = await mod.listPackageIds();

    expect(ids).toEqual([DEFAULT_PACKAGE_ID, "alpha", "zeta"]);
  });

  it("README.mdや形式に合わないファイル名（Bad_Name.json・notjson.txt）を無視する", async () => {
    await mkdir(path.join(tmpDir, "packages"), { recursive: true });
    await writeFile(path.join(tmpDir, "packages", "README.md"), "# packages");
    await writeFile(path.join(tmpDir, "packages", "Bad_Name.json"), "{}");
    await writeFile(path.join(tmpDir, "packages", "notjson.txt"), "not json");
    await writeFile(path.join(tmpDir, "packages", "valid-one.json"), "{}");
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const ids = await mod.listPackageIds();

    expect(ids).toEqual(["valid-one"]);
  });

  it("既定パッケージが無いときは昇順だけ", async () => {
    await mkdir(path.join(tmpDir, "packages"), { recursive: true });
    for (const id of ["zeta", "alpha"]) {
      await writeFile(path.join(tmpDir, "packages", `${id}.json`), "{}");
    }
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const ids = await mod.listPackageIds();

    expect(ids).toEqual(["alpha", "zeta"]);
  });

  it("packagesフォルダが無いときは空配列", async () => {
    vi.stubEnv("CONTENT_DIR", tmpDir);

    const mod = await import("../../../src/lib/packages.js");
    const ids = await mod.listPackageIds();

    expect(ids).toEqual([]);
  });
});
