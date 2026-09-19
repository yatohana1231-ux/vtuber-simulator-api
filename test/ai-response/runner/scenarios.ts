// -------------------------------------------------------
// シナリオの読み込みと、相対日時の解決
//
// api/test/ai-response/scenarios/<機能名>/*.json を読み、形を検証して Scenario[] を返す。
// シナリオ内の日時は "now" / "now-30h" / "now-2d" / "now+15m"（単位 m/h/d）の相対指定を許し、
// 実行開始時刻を基準に resolveScenarioDatetimes() で ISO8601 に解決する。
// -------------------------------------------------------

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TARGET_FUNCTIONS, type Scenario, type TargetFunction } from "./types.js";

// api/test/ai-response/scenarios（このファイルは runner/ 配下）
const DEFAULT_SCENARIOS_DIR = path.resolve(fileURLToPath(import.meta.url), "../../scenarios");

// -------------------------------------------------------
// 相対日時の解決
// -------------------------------------------------------

const RELATIVE_DATETIME_PATTERN = /^now(?:([+-]\d+)([mhd]))?$/;

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

/**
 * シナリオ内の日時1つを解決する。"now"/"now±N単位"（単位 m/h/d）の相対指定は
 * baseTime を基準に ISO8601 に変換する。それ以外（すでに ISO8601 の絶対時刻）はそのまま返す。
 */
export function resolveDatetime(value: string, baseTime: Date): string {
  const match = RELATIVE_DATETIME_PATTERN.exec(value);
  if (!match) return value;

  const [, signed, unit] = match;
  if (!signed || !unit) return baseTime.toISOString();

  const amount = Number(signed);
  return new Date(baseTime.getTime() + amount * UNIT_MS[unit]).toISOString();
}

/**
 * シナリオ（state・request）の中の日時項目をすべて、baseTime を基準に ISO8601 に解決した
 * コピーを返す（元の scenario は変更しない）。
 */
export function resolveScenarioDatetimes(scenario: Scenario, baseTime: Date): Scenario {
  const resolved: Scenario = structuredClone(scenario);
  const dt = (value: string) => resolveDatetime(value, baseTime);

  if (resolved.state) {
    for (const memory of resolved.state.memories ?? []) {
      if (memory.updatedAt !== undefined) memory.updatedAt = dt(memory.updatedAt);
    }
    for (const log of resolved.state.conversationLogs ?? []) {
      log.index = dt(log.index);
    }
    for (const record of resolved.state.absenceRecords ?? []) {
      record.createdAt = dt(record.createdAt);
      record.startDatetime = dt(record.startDatetime);
      record.endDatetime = dt(record.endDatetime);
      for (const action of record.actions ?? []) {
        action.startDatetime = dt(action.startDatetime);
        action.endDatetime = dt(action.endDatetime);
      }
      for (const thread of record.threads ?? []) {
        thread.openedAt = dt(thread.openedAt);
      }
    }
    if (resolved.state.relationship) {
      const relationship = resolved.state.relationship;
      relationship.firstMetAt = dt(relationship.firstMetAt);
      if (relationship.lastConversationAt !== null) relationship.lastConversationAt = dt(relationship.lastConversationAt);
      if (relationship.lastDemotedAt !== null) relationship.lastDemotedAt = dt(relationship.lastDemotedAt);
      relationship.updatedAt = dt(relationship.updatedAt);
    }
    if (resolved.state.affect) {
      const affect = resolved.state.affect;
      if (affect.affectUpdatedAt !== undefined) affect.affectUpdatedAt = dt(affect.affectUpdatedAt);
      if (affect.pendingSession) {
        affect.pendingSession.startedAt = dt(affect.pendingSession.startedAt);
        affect.pendingSession.lastMessageAt = dt(affect.pendingSession.lastMessageAt);
      }
    }
  }

  const request = resolved.request as Record<string, unknown>;
  if (typeof request.lastLoginAt === "string") request.lastLoginAt = dt(request.lastLoginAt);
  if (typeof request.now === "string") request.now = dt(request.now);

  return resolved;
}

// -------------------------------------------------------
// 読み込みと形の検証
// -------------------------------------------------------

function fail(filePath: string, message: string): never {
  throw new Error(`scenarios: ${filePath}: ${message}`);
}

function validateRequest(request: unknown, fn: TargetFunction, filePath: string): void {
  if (typeof request !== "object" || request === null) {
    fail(filePath, "request はオブジェクトである必要があります");
  }
  const r = request as Record<string, unknown>;

  if (fn === "absenceSimulator") {
    if (typeof r.lastLoginAt !== "string") fail(filePath, "request.lastLoginAt は文字列である必要があります");
    if (typeof r.now !== "string") fail(filePath, "request.now は文字列である必要があります");
  } else if (fn === "dialogueGenerator") {
    if (typeof r.message !== "string") fail(filePath, "request.message は文字列である必要があります");
  } else if (fn === "emotionUpdater") {
    if (r.process !== 1 && r.process !== 2) fail(filePath, "request.process は 1 または 2 である必要があります");
    if (r.process === 2 && typeof r.playerMessage !== "string") {
      fail(filePath, "process=2 の request.playerMessage は文字列である必要があります");
    }
    if (r.now !== undefined && typeof r.now !== "string") {
      fail(filePath, "request.now は文字列である必要があります（省略可）");
    }
  } else if (fn === "memoryRetriever") {
    if (r.process !== 1 && r.process !== 2) fail(filePath, "request.process は 1 または 2 である必要があります");
  }
}

function validateScenario(parsed: unknown, expectedId: string, expectedFunction: TargetFunction, filePath: string): Scenario {
  if (typeof parsed !== "object" || parsed === null) {
    fail(filePath, "JSON はオブジェクトである必要があります");
  }
  const v = parsed as Record<string, unknown>;

  if (typeof v.id !== "string" || v.id.length === 0) {
    fail(filePath, "id は非空文字列である必要があります");
  }
  if (v.id !== expectedId) {
    fail(filePath, `id (${String(v.id)}) がファイル名 (${expectedId}) と一致しません`);
  }

  if (v.function !== expectedFunction) {
    fail(filePath, `function (${String(v.function)}) がフォルダ名 (${expectedFunction}) と一致しません`);
  }

  if (typeof v.description !== "string" || v.description.length === 0) {
    fail(filePath, "description は非空文字列である必要があります");
  }

  if (v.packageId !== undefined && typeof v.packageId !== "string") {
    fail(filePath, "packageId は文字列である必要があります");
  }

  if (v.state !== undefined && (typeof v.state !== "object" || v.state === null)) {
    fail(filePath, "state はオブジェクトである必要があります");
  }
  if (v.state !== undefined) {
    const state = (v.state as Record<string, unknown>).affect;
    if (state !== undefined && (typeof state !== "object" || state === null)) {
      fail(filePath, "state.affect はオブジェクトである必要があります");
    }
  }

  if (v.checks !== undefined && !Array.isArray(v.checks)) {
    fail(filePath, "checks は配列である必要があります");
  }
  if (v.judgeFocus !== undefined && !Array.isArray(v.judgeFocus)) {
    fail(filePath, "judgeFocus は配列である必要があります");
  }

  validateRequest(v.request, expectedFunction, filePath);

  return v as unknown as Scenario;
}

/**
 * scenariosDir（既定: api/test/ai-response/scenarios）の下の、機能名ごとのフォルダにある
 * *.json をすべて読み込み、形を検証して返す。フォルダが無い機能はスキップする。
 */
export async function loadScenarios(scenariosDir: string = DEFAULT_SCENARIOS_DIR): Promise<Scenario[]> {
  const scenarios: Scenario[] = [];

  for (const fn of TARGET_FUNCTIONS) {
    const dir = path.join(scenariosDir, fn);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }

    for (const entry of entries.filter((f) => f.endsWith(".json")).sort()) {
      const filePath = path.join(dir, entry);
      const raw = await readFile(filePath, "utf8");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        fail(filePath, `JSON の読み込みに失敗しました: ${(e as Error).message}`);
      }

      const id = entry.replace(/\.json$/, "");
      scenarios.push(validateScenario(parsed, id, fn, filePath));
    }
  }

  return scenarios;
}
