// -------------------------------------------------------
// absenceSimulator 向けのルールによる判定。
// runAbsenceSimulator は AbsenceSimulatorResult を返し、保存した記録
// （AbsenceRecord）は events テーブルへの put として writes に残る。
// -------------------------------------------------------

import type { DynamoWriteRecord, RunResult } from "../types.js";
import type { AbsenceRecord, AbsenceSimulatorResult } from "../../../../src/types.js";
import type { CheckFn, CheckOutcome } from "./types.js";
import { extractJsonFromText, bigramJaccardSimilarity } from "./text.js";
import { countEvents } from "../../../../src/absenceSimulator/eventKindSelection.js";
import { buildAbsenceSkeleton } from "../../../../src/absenceSimulator/skeleton.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

function getOutput(
  output: unknown
): { ok: true; value: AbsenceSimulatorResult } | { ok: false; outcome: CheckOutcome } {
  if (
    typeof output !== "object" ||
    output === null ||
    !Array.isArray((output as AbsenceSimulatorResult).events) ||
    !Array.isArray((output as AbsenceSimulatorResult).actions)
  ) {
    return {
      ok: false,
      outcome: { passed: false, detail: "output が AbsenceSimulatorResult の形ではない" },
    };
  }
  return { ok: true, value: output as AbsenceSimulatorResult };
}

/** シナリオのリクエスト（lastLoginAt/now）を取り出す */
function getAbsenceRequest(
  request: unknown
): { ok: true; lastLoginAt: string; now: string } | { ok: false; outcome: CheckOutcome } {
  const req = request as Record<string, unknown> | undefined;
  if (typeof req?.lastLoginAt !== "string" || typeof req?.now !== "string") {
    return {
      ok: false,
      outcome: { passed: false, detail: "シナリオの request に lastLoginAt/now が無い" },
    };
  }
  return { ok: true, lastLoginAt: req.lastLoginAt, now: req.now };
}

/** 保存された記録（events テーブルへの最後の put）を取り出す */
export function getSavedAbsenceRecord(result: RunResult): AbsenceRecord | undefined {
  const writes = result.writes.filter(
    (w): w is DynamoWriteRecord => w.table === "events" && w.operation === "put"
  );
  const last = writes[writes.length - 1];
  if (!last) return undefined;
  const item = last.item as Partial<AbsenceRecord>;
  if (!Array.isArray(item.events) || !Array.isArray(item.threads)) return undefined;
  return item as AbsenceRecord;
}

export const eventCountMatchesSkeleton: CheckFn = (result, context) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const req = getAbsenceRequest(context.resolvedScenario.request);
  if (!req.ok) return req.outcome;

  const elapsedMs = new Date(req.now).getTime() - new Date(req.lastLoginAt).getTime();
  const expected = countEvents(elapsedMs);
  const actual = output.value.events.length;
  const passed = actual === expected;
  return { passed, detail: passed ? undefined : `出来事の件数 ${actual}（期待 ${expected}）` };
};

/**
 * 最後の Bedrock 応答の JSON の actions に、骨格の全枠（1..出力の actions の件数）の
 * 番号がそろっているか。そろっていない番号は buildActions（src/absenceSimulator/modelOutput.ts）
 * によって生活リズムの activity で補われている。
 */
export const actionsMatchedByIndex: CheckFn = (result) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const slotCount = output.value.actions.length;
  if (slotCount === 0) return { passed: true };

  const lastCall = result.modelCalls[result.modelCalls.length - 1];
  if (!lastCall) return { passed: false, detail: "Bedrock の呼び出しが無い" };

  const parsed = extractJsonFromText(lastCall.responseText);
  if (!parsed.ok) return { passed: false, detail: parsed.reason };

  const value = parsed.value as Record<string, unknown>;
  const rawActions = Array.isArray(value.actions) ? value.actions : [];

  const matchedIndices = new Set<number>();
  for (const raw of rawActions) {
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as Record<string, unknown>;
    if (typeof v.index === "number" && typeof v.action === "string" && v.action.trim() !== "") {
      matchedIndices.add(v.index);
    }
  }

  const missing: number[] = [];
  for (let i = 1; i <= slotCount; i++) {
    if (!matchedIndices.has(i)) missing.push(i);
  }
  const passed = missing.length === 0;
  return {
    passed,
    detail: passed ? undefined : `生活リズムの文面で補われた枠: index ${missing.join(", ")}`,
  };
};

export const slotActionMustNotContain: CheckFn = (result, context, params) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const activityIncludes = params?.activityIncludes;
  const words = params?.words;
  if (
    typeof activityIncludes !== "string" ||
    !Array.isArray(words) ||
    words.length === 0 ||
    !words.every((w) => typeof w === "string")
  ) {
    return { passed: false, detail: "params.activityIncludes / params.words が不正" };
  }

  const req = getAbsenceRequest(context.resolvedScenario.request);
  if (!req.ok) return req.outcome;

  const skeleton = buildAbsenceSkeleton({
    lifestyle: context.lifestyle,
    timeZone: context.world.timezone,
    lastLoginAt: new Date(req.lastLoginAt),
    now: new Date(req.now),
  });
  const slotsByStart = new Map(skeleton.actionSlots.map((slot) => [slot.startDatetime, slot]));

  const violations: string[] = [];
  for (const action of output.value.actions) {
    const slot = slotsByStart.get(action.startDatetime);
    if (!slot || !slot.activity.includes(activityIncludes)) continue;
    const hitWord = (words as string[]).find(
      (w) => action.action.includes(w) || action.memo.includes(w)
    );
    if (hitWord) {
      violations.push(`${action.startDatetime} action="${action.action}" memo="${action.memo}"（語: ${hitWord}）`);
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

export const noRepeatOfRecentEvents: CheckFn = (result, context, params) => {
  const output = getOutput(result.output);
  if (!output.ok) return output.outcome;

  const threshold = typeof params?.threshold === "number" ? params.threshold : DEFAULT_SIMILARITY_THRESHOLD;
  const recentSummaries = (context.resolvedScenario.state?.absenceRecords ?? []).flatMap((r) =>
    r.events.map((e) => e.summary)
  );

  const violations: string[] = [];
  for (const event of output.value.events) {
    for (const recent of recentSummaries) {
      const sim = bigramJaccardSimilarity(event.summary, recent);
      if (sim >= threshold) {
        violations.push(`"${event.summary}" が過去の "${recent}" と類似（${sim.toFixed(2)}）`);
      }
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

export const noDuplicateThreads: CheckFn = (result, _context, params) => {
  const record = getSavedAbsenceRecord(result);
  if (!record) return { passed: false, detail: "events テーブルへの保存が writes に無い" };

  const threshold = typeof params?.threshold === "number" ? params.threshold : DEFAULT_SIMILARITY_THRESHOLD;
  const openTopics = record.threads.filter((t) => t.status === "open").map((t) => t.topic);

  const violations: string[] = [];
  for (let i = 0; i < openTopics.length; i++) {
    for (let j = i + 1; j < openTopics.length; j++) {
      const sim = bigramJaccardSimilarity(openTopics[i], openTopics[j]);
      if (sim >= threshold) {
        violations.push(`"${openTopics[i]}" と "${openTopics[j]}" が類似（${sim.toFixed(2)}）`);
      }
    }
  }
  return { passed: violations.length === 0, detail: violations.length > 0 ? violations.join(" / ") : undefined };
};

export const threadContinued: CheckFn = (result, _context, params) => {
  const record = getSavedAbsenceRecord(result);
  if (!record) return { passed: false, detail: "events テーブルへの保存が writes に無い" };

  const text = params?.threadTopicIncludes;
  if (typeof text !== "string" || text === "") {
    return { passed: false, detail: "params.threadTopicIncludes が不正" };
  }

  const matchingThreadIds = new Set(
    record.threads.filter((t) => t.topic.includes(text)).map((t) => t.id)
  );
  if (matchingThreadIds.size === 0) {
    return { passed: false, detail: `topic に "${text}" を含む話題が保存された記録に無い` };
  }

  const passed = record.events.some((e) => e.threadId && matchingThreadIds.has(e.threadId));
  return {
    passed,
    detail: passed
      ? undefined
      : `topic に "${text}" を含む話題を threadId に持つ出来事が無い`,
  };
};
