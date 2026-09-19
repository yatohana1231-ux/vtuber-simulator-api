// -------------------------------------------------------
// キャラクター×世界観パッケージの読み込み（api/content/ 配下の JSON）
// -------------------------------------------------------

import { readFile } from "fs/promises";
import path from "path";

import type {
  CharacterDefinition,
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

/**
 * character.relationshipStages の形式を検証し、各段階の speechExamples を先頭 MAX_SPEECH_EXAMPLES 件に
 * 切り詰めた配列を返す。不正なら例外
 */
function validateRelationshipStages(stages: RelationshipStage[], packageId: string): RelationshipStage[] {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(`package ${packageId} has invalid character.relationshipStages: must be a non-empty array`);
  }

  const seenKeys = new Set<string>();
  return stages.map((stage, i) => {
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

    return {
      ...stage,
      speechExamples: (stage.speechExamples ?? []).slice(0, MAX_SPEECH_EXAMPLES),
    };
  });
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
