// -------------------------------------------------------
// キャラクター×世界観パッケージの読み込み（api/content/ 配下の JSON）
// -------------------------------------------------------

import { readFile } from "fs/promises";
import path from "path";

import type {
  AffectTuning,
  AttachmentStyle,
  BigFive,
  CharacterDefinition,
  CharacterGoal,
  CharacterPackage,
  Lifestyle,
  Perception,
  RelationshipStage,
  RelationshipStagePromotion,
  ScheduleSlot,
  World,
} from "../types.js";

export const DEFAULT_PACKAGE_ID = "yui-modern-tokyo";

const MAX_SPEECH_EXAMPLES = 5;

// ファイル名に使うため、パストラバーサルを防ぐ目的で文字種を限定する
const ID_PATTERN = /^[a-z0-9-]+$/;

// "HH:MM" 形式（世界観のタイムゾーンでの時刻）
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const cache = new Map<string, CharacterPackage>();

/**
 * Lambda では dist/ の中身が LAMBDA_TASK_ROOT に展開され、ビルド時に dist/content/ へコピーされている。
 * ソースから直接実行する場合（test-runner など）は CONTENT_DIR で api/content/ を指定する。
 */
function contentDir(): string {
  if (process.env.CONTENT_DIR) return process.env.CONTENT_DIR;
  if (process.env.LAMBDA_TASK_ROOT) return path.join(process.env.LAMBDA_TASK_ROOT, "content");
  throw new Error("CONTENT_DIR or LAMBDA_TASK_ROOT must be set to locate content files");
}

export function isValidPackageId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** リクエストボディの packageId を解決する。省略時は既定パッケージ、不正・存在しない場合は null */
export async function loadRequestedPackage(packageId: unknown): Promise<CharacterPackage | null> {
  if (packageId === undefined) return loadPackage(DEFAULT_PACKAGE_ID);
  if (typeof packageId !== "string") return null;
  return loadPackage(packageId);
}

async function readContentJson<T>(folder: string, key: string): Promise<T | null> {
  if (!ID_PATTERN.test(key)) {
    throw new Error(`invalid content key: ${folder}/${key}`);
  }
  try {
    const raw = await readFile(path.join(contentDir(), folder, `${key}.json`), "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** world.timezone が文字列かつ有効なIANAタイムゾーンであることを検証する。不正なら例外 */
function validateWorldTimezone(world: World, packageId: string): void {
  if (typeof world.timezone !== "string" || world.timezone.length === 0) {
    throw new Error(`package ${packageId} has invalid world.timezone: ${JSON.stringify(world.timezone)}`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: world.timezone });
  } catch {
    throw new Error(`package ${packageId} has invalid world.timezone: ${world.timezone}`);
  }
}

/** 生活様式のスケジュール枠1件の形式を検証する。不正なら例外 */
function validateScheduleSlot(slot: ScheduleSlot, packageId: string, context: string): void {
  if (
    typeof slot.start !== "string" ||
    typeof slot.end !== "string" ||
    !HHMM_PATTERN.test(slot.start) ||
    !HHMM_PATTERN.test(slot.end)
  ) {
    throw new Error(`package ${packageId} has invalid ${context}: start/end must be "HH:MM" (${JSON.stringify(slot)})`);
  }
  if (slot.start === slot.end) {
    throw new Error(`package ${packageId} has invalid ${context}: start and end must differ (${JSON.stringify(slot)})`);
  }
  if (typeof slot.activity !== "string" || slot.activity.length === 0) {
    throw new Error(`package ${packageId} has invalid ${context}: activity must be a non-empty string (${JSON.stringify(slot)})`);
  }
  if (slot.fatigueChangePerHour !== undefined && !isFiniteNumberInRange(slot.fatigueChangePerHour, -100, 100)) {
    throw new Error(
      `package ${packageId} has invalid ${context}: fatigueChangePerHour must be a finite number -100 to 100 (${JSON.stringify(slot)})`
    );
  }
}

/** 生活様式（schedules / eventKinds）の形式を検証する。不正なら例外 */
function validateLifestyle(lifestyle: Lifestyle, packageId: string): void {
  const { schedules, eventKinds } = lifestyle;
  if (!schedules || !Array.isArray(schedules.weekday) || !Array.isArray(schedules.holiday)) {
    throw new Error(`package ${packageId} has invalid lifestyle.schedules: weekday/holiday must be arrays`);
  }
  for (const slot of schedules.weekday) {
    validateScheduleSlot(slot, packageId, "lifestyle.schedules.weekday");
  }
  for (const slot of schedules.holiday) {
    validateScheduleSlot(slot, packageId, "lifestyle.schedules.holiday");
  }

  if (!Array.isArray(eventKinds) || eventKinds.length === 0) {
    throw new Error(`package ${packageId} has invalid lifestyle.eventKinds: must be a non-empty array`);
  }
  for (const kind of eventKinds) {
    if (typeof kind.key !== "string" || kind.key.length === 0) {
      throw new Error(`package ${packageId} has invalid lifestyle.eventKinds: key must be a non-empty string (${JSON.stringify(kind)})`);
    }
    if (typeof kind.label !== "string" || kind.label.length === 0) {
      throw new Error(`package ${packageId} has invalid lifestyle.eventKinds: label must be a non-empty string (${JSON.stringify(kind)})`);
    }
    if (typeof kind.weight !== "number" || !Number.isFinite(kind.weight) || kind.weight <= 0) {
      throw new Error(`package ${packageId} has invalid lifestyle.eventKinds: weight must be a positive finite number (${JSON.stringify(kind)})`);
    }
  }
}

const PERCEPTION_KEYS: (keyof Perception)[] = [
  "trust",
  "affection",
  "respect",
  "fear",
  "dependence",
  "familiarity",
];

/** perception の1軸の値として妥当か（1〜100の整数） */
function isValidPerceptionValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
}

/** 有限の数値で min〜max の範囲内か（D-040 で追加した項目はどれも整数を要求しない） */
function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** character.bigFive の形式を検証する（D-040）。省略可。不正なら例外 */
function validateBigFive(bigFive: BigFive | undefined, packageId: string): void {
  if (bigFive === undefined) return;
  if (!bigFive || typeof bigFive !== "object" || Array.isArray(bigFive)) {
    throw new Error(`package ${packageId} has invalid character.bigFive: must be an object`);
  }
  const keys: (keyof BigFive)[] = [
    "openness",
    "conscientiousness",
    "extraversion",
    "agreeableness",
    "neuroticism",
  ];
  for (const key of keys) {
    if (!isFiniteNumberInRange(bigFive[key], -100, 100)) {
      throw new Error(`package ${packageId} has invalid character.bigFive.${key}: must be a finite number -100 to 100`);
    }
  }
}

/** character.goals の形式を検証する（D-040）。省略可。不正なら例外 */
function validateGoals(goals: CharacterGoal[] | undefined, packageId: string): void {
  if (goals === undefined) return;
  if (!Array.isArray(goals)) {
    throw new Error(`package ${packageId} has invalid character.goals: must be an array`);
  }
  const seenKeys = new Set<string>();
  goals.forEach((goal, i) => {
    const context = `character.goals[${i}]`;
    if (typeof goal.key !== "string" || goal.key.length === 0) {
      throw new Error(`package ${packageId} has invalid ${context}: key must be a non-empty string`);
    }
    if (seenKeys.has(goal.key)) {
      throw new Error(`package ${packageId} has invalid ${context}: duplicate key "${goal.key}"`);
    }
    seenKeys.add(goal.key);
    if (typeof goal.description !== "string" || goal.description.length === 0) {
      throw new Error(`package ${packageId} has invalid ${context}: description must be a non-empty string`);
    }
    if (!isFiniteNumberInRange(goal.importance, 1, 100)) {
      throw new Error(`package ${packageId} has invalid ${context}: importance must be a number 1-100`);
    }
  });
}

const ATTACHMENT_STYLES: AttachmentStyle[] = ["secure", "anxious", "avoidant"];

/** character.attachmentStyle の形式を検証する（D-040）。省略可。不正なら例外 */
function validateAttachmentStyle(style: AttachmentStyle | undefined, packageId: string): void {
  if (style === undefined) return;
  if (!ATTACHMENT_STYLES.includes(style)) {
    throw new Error(
      `package ${packageId} has invalid character.attachmentStyle: must be one of ${ATTACHMENT_STYLES.join(", ")} (${JSON.stringify(style)})`
    );
  }
}

// affectTuning のうち moodHomeBase 以外の、数値で0より大きいことを求める項目
const AFFECT_TUNING_POSITIVE_KEYS = [
  "positiveEmotionGain",
  "negativeEmotionGain",
  "emotionHalfLifeScale",
  "moodHalfLifeScale",
  "lonelinessGrowthScale",
  "perceptionGainScale",
  "perceptionDampingSigma",
] as const;

const AFFECT_TUNING_KEYS: string[] = ["moodHomeBase", ...AFFECT_TUNING_POSITIVE_KEYS];

/** character.affectTuning の形式を検証する（D-040）。省略可。知らないキーがあれば例外 */
function validateAffectTuning(tuning: AffectTuning | undefined, packageId: string): void {
  if (tuning === undefined) return;
  if (!tuning || typeof tuning !== "object" || Array.isArray(tuning)) {
    throw new Error(`package ${packageId} has invalid character.affectTuning: must be an object`);
  }
  for (const key of Object.keys(tuning)) {
    if (!AFFECT_TUNING_KEYS.includes(key)) {
      throw new Error(`package ${packageId} has invalid character.affectTuning: unknown key "${key}"`);
    }
  }
  if (tuning.moodHomeBase !== undefined) {
    const pad = tuning.moodHomeBase;
    if (!pad || typeof pad !== "object" || Array.isArray(pad)) {
      throw new Error(`package ${packageId} has invalid character.affectTuning.moodHomeBase: must be an object`);
    }
    for (const axis of ["pleasure", "arousal", "dominance"] as const) {
      if (!isFiniteNumberInRange(pad[axis], -100, 100)) {
        throw new Error(
          `package ${packageId} has invalid character.affectTuning.moodHomeBase.${axis}: must be a finite number -100 to 100`
        );
      }
    }
  }
  for (const key of AFFECT_TUNING_POSITIVE_KEYS) {
    const value = tuning[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`package ${packageId} has invalid character.affectTuning.${key}: must be a finite number greater than 0`);
    }
  }
}

/** character.initialPerception の形式を検証する。不正なら例外 */
function validateInitialPerception(perception: Perception, packageId: string): void {
  if (!perception || typeof perception !== "object") {
    throw new Error(`package ${packageId} has invalid character.initialPerception: must be an object`);
  }
  for (const key of PERCEPTION_KEYS) {
    if (!isValidPerceptionValue(perception[key])) {
      throw new Error(
        `package ${packageId} has invalid character.initialPerception.${key}: must be an integer 1-100 (${JSON.stringify(perception)})`
      );
    }
  }
}

/** relationshipStages の要素（先頭以外）の promoteWhen の形式を検証する。不正なら例外 */
function validatePromoteWhen(
  promotion: RelationshipStagePromotion,
  packageId: string,
  context: string
): void {
  if (!promotion || typeof promotion !== "object") {
    throw new Error(`package ${packageId} has invalid ${context}: promoteWhen must be an object`);
  }
  if (
    typeof promotion.minConversationDays !== "number" ||
    !Number.isInteger(promotion.minConversationDays) ||
    promotion.minConversationDays < 0
  ) {
    throw new Error(
      `package ${packageId} has invalid ${context}: promoteWhen.minConversationDays must be an integer >= 0`
    );
  }
  if (
    typeof promotion.minConversationCount !== "number" ||
    !Number.isInteger(promotion.minConversationCount) ||
    promotion.minConversationCount < 0
  ) {
    throw new Error(
      `package ${packageId} has invalid ${context}: promoteWhen.minConversationCount must be an integer >= 0`
    );
  }
  if (
    !promotion.minPerception ||
    typeof promotion.minPerception !== "object" ||
    Array.isArray(promotion.minPerception)
  ) {
    throw new Error(`package ${packageId} has invalid ${context}: promoteWhen.minPerception must be an object`);
  }
  for (const [key, value] of Object.entries(promotion.minPerception)) {
    if (!PERCEPTION_KEYS.includes(key as keyof Perception)) {
      throw new Error(
        `package ${packageId} has invalid ${context}: promoteWhen.minPerception has unknown key "${key}"`
      );
    }
    if (!isValidPerceptionValue(value)) {
      throw new Error(
        `package ${packageId} has invalid ${context}: promoteWhen.minPerception.${key} must be an integer 1-100`
      );
    }
  }
}

/** relationshipStages[].maxPerception の形式を検証する（D-040）。不正なら例外 */
function validateMaxPerception(
  maxPerception: Partial<Perception> | undefined,
  packageId: string,
  context: string
): void {
  if (maxPerception === undefined) return;
  if (!maxPerception || typeof maxPerception !== "object" || Array.isArray(maxPerception)) {
    throw new Error(`package ${packageId} has invalid ${context}: maxPerception must be an object`);
  }
  for (const [key, value] of Object.entries(maxPerception)) {
    if (!PERCEPTION_KEYS.includes(key as keyof Perception)) {
      throw new Error(`package ${packageId} has invalid ${context}: maxPerception has unknown key "${key}"`);
    }
    if (!isFiniteNumberInRange(value, 1, 100)) {
      throw new Error(`package ${packageId} has invalid ${context}: maxPerception.${key} must be a number 1-100`);
    }
  }
}

/**
 * 段階 N の maxPerception の各軸が、段階 N+1 の promoteWhen.minPerception の同じ軸以上であることを検証する（D-040）。
 * 低いと永久に上がれないため。軸を書いていない maxPerception の上限は 100 とみなす。不正なら例外
 */
function validateStagePerceptionCeilingConsistency(stages: RelationshipStage[], packageId: string): void {
  for (let i = 0; i < stages.length - 1; i++) {
    const current = stages[i];
    const next = stages[i + 1];
    const nextMinPerception = next.promoteWhen?.minPerception ?? {};
    for (const [key, minValue] of Object.entries(nextMinPerception)) {
      const maxValue = current.maxPerception?.[key as keyof Perception] ?? 100;
      if (typeof minValue === "number" && maxValue < minValue) {
        throw new Error(
          `package ${packageId} has invalid character.relationshipStages[${i}].maxPerception.${key}: ` +
            `must be >= relationshipStages[${i + 1}].promoteWhen.minPerception.${key} (${maxValue} < ${minValue})`
        );
      }
    }
  }
}

/**
 * character.initialPerception の各軸が、最初の段階の maxPerception の同じ軸以下であることを検証する（D-040）。
 * 軸を書いていない maxPerception の上限は 100 とみなす。不正なら例外
 */
function validateInitialPerceptionWithinFirstStage(
  perception: Perception,
  firstStage: RelationshipStage,
  packageId: string
): void {
  for (const key of PERCEPTION_KEYS) {
    const maxValue = firstStage.maxPerception?.[key] ?? 100;
    if (perception[key] > maxValue) {
      throw new Error(
        `package ${packageId} has invalid character.initialPerception.${key}: ` +
          `must be <= relationshipStages[0].maxPerception.${key} (${perception[key]} > ${maxValue})`
      );
    }
  }
}

/**
 * character.relationshipStages の形式を検証し、各段階の speechExamples を先頭 MAX_SPEECH_EXAMPLES 件に
 * 切り詰めた配列を返す。不正なら例外
 */
function validateRelationshipStages(stages: RelationshipStage[], packageId: string): RelationshipStage[] {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(`package ${packageId} has invalid character.relationshipStages: must be a non-empty array`);
  }

  const seenKeys = new Set<string>();
  const validated = stages.map((stage, i) => {
    const context = `character.relationshipStages[${i}]`;

    if (typeof stage.key !== "string" || stage.key.length === 0) {
      throw new Error(`package ${packageId} has invalid ${context}: key must be a non-empty string`);
    }
    if (seenKeys.has(stage.key)) {
      throw new Error(`package ${packageId} has invalid ${context}: duplicate key "${stage.key}"`);
    }
    seenKeys.add(stage.key);

    for (const field of ["label", "description", "speechStyle"] as const) {
      if (typeof stage[field] !== "string" || stage[field].length === 0) {
        throw new Error(`package ${packageId} has invalid ${context}: ${field} must be a non-empty string`);
      }
    }

    if (stage.speechExamples !== undefined && !Array.isArray(stage.speechExamples)) {
      throw new Error(`package ${packageId} has invalid ${context}: speechExamples must be an array`);
    }

    if (i === 0) {
      if (stage.promoteWhen !== null) {
        throw new Error(`package ${packageId} has invalid ${context}: first stage's promoteWhen must be null`);
      }
    } else {
      if (!stage.promoteWhen) {
        throw new Error(`package ${packageId} has invalid ${context}: promoteWhen is required`);
      }
      validatePromoteWhen(stage.promoteWhen, packageId, context);
    }

    validateMaxPerception(stage.maxPerception, packageId, context);

    return {
      ...stage,
      speechExamples: (stage.speechExamples ?? []).slice(0, MAX_SPEECH_EXAMPLES),
    };
  });

  validateStagePerceptionCeilingConsistency(validated, packageId);

  return validated;
}

/**
 * パッケージを読み込み、世界観・キャラクター・生活様式を解決して返す。
 * パッケージが存在しない場合は null。パッケージが参照する世界観・キャラクター・生活様式が無い場合、
 * または形式が不正な場合は設定ミスとして例外。
 */
export async function loadPackage(packageId: string): Promise<CharacterPackage | null> {
  if (!isValidPackageId(packageId)) return null;

  const cached = cache.get(packageId);
  if (cached) return cached;

  const manifest = await readContentJson<{
    id: string;
    displayName: string;
    world: string;
    character: string;
    lifestyle: string;
  }>("packages", packageId);
  if (!manifest) return null;

  const world = await readContentJson<World>("worlds", manifest.world);
  if (!world) {
    throw new Error(`package ${packageId} references missing world: ${manifest.world}`);
  }
  const character = await readContentJson<CharacterDefinition>("characters", manifest.character);
  if (!character) {
    throw new Error(`package ${packageId} references missing character: ${manifest.character}`);
  }
  const lifestyle = await readContentJson<Lifestyle>("lifestyles", manifest.lifestyle);
  if (!lifestyle) {
    throw new Error(`package ${packageId} references missing lifestyle: ${manifest.lifestyle}`);
  }

  validateWorldTimezone(world, packageId);
  validateLifestyle(lifestyle, packageId);
  validateInitialPerception(character.initialPerception, packageId);
  const relationshipStages = validateRelationshipStages(character.relationshipStages, packageId);
  validateInitialPerceptionWithinFirstStage(character.initialPerception, relationshipStages[0], packageId);
  validateBigFive(character.bigFive, packageId);
  validateGoals(character.goals, packageId);
  validateAttachmentStyle(character.attachmentStyle, packageId);
  validateAffectTuning(character.affectTuning, packageId);

  const pkg: CharacterPackage = {
    id: manifest.id,
    displayName: manifest.displayName,
    world,
    character: {
      ...character,
      speechExamples: (character.speechExamples ?? []).slice(0, MAX_SPEECH_EXAMPLES),
      relationshipStages,
    },
    lifestyle,
  };
  cache.set(packageId, pkg);
  console.log(
    `[loadPackage] loaded package=${packageId} world=${world.key} character=${character.key} lifestyle=${lifestyle.key}`
  );
  return pkg;
}
