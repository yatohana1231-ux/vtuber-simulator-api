// -------------------------------------------------------
// testerCharacters
// テスターごとのキャラクターの一覧・作成（tester-character-ownership-roadmap フェーズ3b）。
// GET /characters・POST /characters が呼ぶ。
// -------------------------------------------------------

import { randomUUID } from "crypto";

import { createTesterCharacter, listTesterCharacters } from "../lib/dynamo.js";
import { loadRequestedPackage } from "../lib/packages.js";
import type { TesterCharacter } from "../types.js";

/** 1テスターあたりのキャラクターの上限（.notes/tester-character-ownership-roadmap.md 検討事項2） */
export const MAX_CHARACTERS_PER_TESTER = 5;

const LABEL_MAX_LENGTH = 30;

// DynamoDB（@aws-sdk/client-dynamodb）が条件付き書き込みの失敗時に投げる例外の name
const CONDITIONAL_CHECK_FAILED_EXCEPTION_NAME = "ConditionalCheckFailedException";

/** 入力（packageId・label）が不正なときの例外。400 に対応する */
export class TesterCharacterInputError extends Error {}

/** 1テスターあたりの上限（MAX_CHARACTERS_PER_TESTER）に達しているときの例外。409 に対応する */
export class TesterCharacterLimitError extends Error {
  constructor() {
    super("character limit reached");
    this.name = "TesterCharacterLimitError";
  }
}

/** testerId を含まない、レスポンス用のキャラクターの要約 */
export interface CharacterSummary {
  characterId: string;
  packageId: string;
  label: string;
  createdAt: string;
}

function toSummary(record: TesterCharacter): CharacterSummary {
  return {
    characterId: record.characterId,
    packageId: record.packageId,
    label: record.label,
    createdAt: record.createdAt,
  };
}

/** DynamoDB の PutCommand が条件付き書き込みの失敗（同じ character_id が既にある）で投げた例外かどうか */
function isConditionalCheckFailedException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === CONDITIONAL_CHECK_FAILED_EXCEPTION_NAME
  );
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

/** テスターのキャラクターの一覧を返す（作成日時の古い順。testerId は含まない） */
export async function runListTesterCharacters(
  testerId: string
): Promise<{ characters: CharacterSummary[] }> {
  const characters = await listTesterCharacters(testerId);
  return { characters: characters.map(toSummary) };
}

/**
 * packageId を解決する。省略時は既定パッケージ（`packages.ts` の DEFAULT_PACKAGE_ID）、
 * 形式不正・存在しない場合は TesterCharacterInputError（`packages.ts` の既存の検証を使う）。
 */
async function resolvePackageId(packageId: unknown): Promise<string> {
  const pkg = await loadRequestedPackage(packageId);
  if (!pkg) {
    throw new TesterCharacterInputError("unknown packageId");
  }
  return pkg.id;
}

/**
 * リクエストで指定された label を検証する。
 * - 未指定・null・前後の空白を除くと空文字 → undefined（呼び出し元が既定の名前を使う）
 * - 文字列でない・前後の空白を除いて30文字を超える → TesterCharacterInputError
 * - それ以外 → 前後の空白を除いた文字列
 */
function resolveProvidedLabel(label: unknown): string | undefined {
  if (label === undefined || label === null) return undefined;
  if (typeof label !== "string") {
    throw new TesterCharacterInputError("label must be a string");
  }
  const trimmed = label.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > LABEL_MAX_LENGTH) {
    throw new TesterCharacterInputError(
      `label must be ${LABEL_MAX_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export interface CreateTesterCharacterInput {
  packageId?: unknown;
  label?: unknown;
}

/**
 * テスターのキャラクターを新規作成する。
 * - packageId 省略時は既定パッケージ、不正・存在しない packageId は TesterCharacterInputError
 * - label 省略・空文字は「キャラクター{n}」（n は作成前の既存件数+1）、不正な label は TesterCharacterInputError
 * - 既に MAX_CHARACTERS_PER_TESTER 件あれば TesterCharacterLimitError
 * - characterId は randomUUID() で発番する。DynamoDB の条件付き書き込みが失敗したら
 *   （既に同じ characterId が存在する、ほぼ起きない）1回だけ発番し直す
 */
export async function runCreateTesterCharacter(
  testerId: string,
  input: CreateTesterCharacterInput
): Promise<CharacterSummary> {
  const packageId = await resolvePackageId(input.packageId);
  const providedLabel = resolveProvidedLabel(input.label);

  const existing = await listTesterCharacters(testerId);
  if (existing.length >= MAX_CHARACTERS_PER_TESTER) {
    throw new TesterCharacterLimitError();
  }

  const label = providedLabel ?? `キャラクター${existing.length + 1}`;
  const createdAt = new Date().toISOString();

  const record: TesterCharacter = {
    testerId,
    characterId: randomUUID(),
    packageId,
    label,
    createdAt,
  };

  try {
    await createTesterCharacter(record);
  } catch (error) {
    if (!isConditionalCheckFailedException(error)) {
      throw error;
    }
    const retryRecord: TesterCharacter = { ...record, characterId: randomUUID() };
    await createTesterCharacter(retryRecord);
    return toSummary(retryRecord);
  }

  return toSummary(record);
}
