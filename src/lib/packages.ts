// -------------------------------------------------------
// キャラクター×世界観パッケージの読み込み（api/content/ 配下の JSON）
// -------------------------------------------------------

import { readFile } from "fs/promises";
import path from "path";

import type {
  CharacterDefinition,
  CharacterPackage,
  World,
} from "../types.js";

export const DEFAULT_PACKAGE_ID = "yui-modern-tokyo";

const MAX_SPEECH_EXAMPLES = 5;

// ファイル名に使うため、パストラバーサルを防ぐ目的で文字種を限定する
const ID_PATTERN = /^[a-z0-9-]+$/;

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

/**
 * パッケージを読み込み、世界観とキャラクターを解決して返す。
 * パッケージが存在しない場合は null。パッケージが参照する世界観・キャラクターが無い場合は設定ミスとして例外。
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

  const pkg: CharacterPackage = {
    id: manifest.id,
    displayName: manifest.displayName,
    world,
    character: {
      ...character,
      speechExamples: (character.speechExamples ?? []).slice(0, MAX_SPEECH_EXAMPLES),
    },
  };
  cache.set(packageId, pkg);
  console.log(`[loadPackage] loaded package=${packageId} world=${world.key} character=${character.key}`);
  return pkg;
}
