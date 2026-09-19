import { describe, expect, it } from "vitest";
import {
  actionsMatchedByIndex,
  eventCountMatchesSkeleton,
  noDuplicateThreads,
  noRepeatOfRecentEvents,
  slotActionMustNotContain,
  threadContinued,
} from "./absenceSimulator.js";
import { makeContext, makeModelCall, makeRunResult, makeScenario } from "./fixtures.js";
import { countEvents } from "../../../../src/absenceSimulator/eventKindSelection.js";
import { buildAbsenceSkeleton } from "../../../../src/absenceSimulator/skeleton.js";
import type { AbsenceRecord } from "../../../../src/types.js";

// DynamoWriteRecord.item は Record<string, unknown> 型。AbsenceRecord（interface）は
// 明示のインデックスシグネチャが無いため直接は代入できず、unknown を経由してキャストする。
function toWriteItem(record: AbsenceRecord): Record<string, unknown> {
  return record as unknown as Record<string, unknown>;
}

function baseAbsenceRecordItem(overrides: Partial<AbsenceRecord> = {}): AbsenceRecord {
  return {
    event_id: "event-1",
    characterId: "character-1",
    createdAt: "2026-09-19T00:00:00.000Z",
    startDatetime: "2026-09-18T13:00:00.000Z",
    endDatetime: "2026-09-18T20:00:00.000Z",
    events: [],
    actions: [],
    threads: [],
    ...overrides,
  };
}

describe("eventCountMatchesSkeleton", () => {
  const request = { lastLoginAt: "2026-09-18T00:00:00+09:00", now: "2026-09-19T12:00:00+09:00" };
  const expected = countEvents(new Date(request.now).getTime() - new Date(request.lastLoginAt).getTime());

  it("passes when the event count matches countEvents", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", request }) });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: Array.from({ length: expected }, () => ({ kind: "daily", summary: "s", detail: "d" })), actions: [] },
    });
    expect(eventCountMatchesSkeleton(result, context, undefined).passed).toBe(true);
  });

  it("fails when the event count does not match", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", request }) });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: Array.from({ length: Math.max(0, expected - 1) }, () => ({ kind: "daily", summary: "s", detail: "d" })), actions: [] },
    });
    const outcome = eventCountMatchesSkeleton(result, context, undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain(String(expected));
  });

  it("fails when the scenario request is missing lastLoginAt/now", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", request: { message: "x" } }) });
    const result = makeRunResult({ function: "absenceSimulator", output: { events: [], actions: [] } });
    expect(eventCountMatchesSkeleton(result, context, undefined).passed).toBe(false);
  });

  it("fails when output is not an AbsenceSimulatorResult", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", request }) });
    const result = makeRunResult({ function: "absenceSimulator", output: "not the right shape" });
    expect(eventCountMatchesSkeleton(result, context, undefined).passed).toBe(false);
  });
});

describe("actionsMatchedByIndex", () => {
  it("passes when every slot index is present with a non-empty action", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [], actions: [{ startDatetime: "a", endDatetime: "b", action: "x", memo: "" }, { startDatetime: "b", endDatetime: "c", action: "y", memo: "" }] },
      modelCalls: [
        makeModelCall({
          responseText: '```json\n{"actions":[{"index":1,"action":"朝起きた"},{"index":2,"action":"学校に行った"}]}\n```',
        }),
      ],
    });
    expect(actionsMatchedByIndex(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails and reports missing indices when a slot is not matched", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      output: {
        events: [],
        actions: [
          { startDatetime: "a", endDatetime: "b", action: "x", memo: "" },
          { startDatetime: "b", endDatetime: "c", action: "y", memo: "" },
          { startDatetime: "c", endDatetime: "d", action: "z", memo: "" },
        ],
      },
      modelCalls: [makeModelCall({ responseText: '```json\n{"actions":[{"index":1,"action":"朝起きた"}]}\n```' })],
    });
    const outcome = actionsMatchedByIndex(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("2");
    expect(outcome.detail).toContain("3");
  });

  it("passes trivially when there are no action slots", () => {
    const result = makeRunResult({ function: "absenceSimulator", output: { events: [], actions: [] }, modelCalls: [] });
    expect(actionsMatchedByIndex(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when there is no model call but slots exist", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [], actions: [{ startDatetime: "a", endDatetime: "b", action: "x", memo: "" }] },
      modelCalls: [],
    });
    expect(actionsMatchedByIndex(result, makeContext(), undefined).passed).toBe(false);
  });

  it("fails when the last response has no parsable JSON", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [], actions: [{ startDatetime: "a", endDatetime: "b", action: "x", memo: "" }] },
      modelCalls: [makeModelCall({ responseText: "not json at all" })],
    });
    expect(actionsMatchedByIndex(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("slotActionMustNotContain", () => {
  const context = makeContext();
  const lastLoginAt = new Date("2026-09-18T22:00:00+09:00");
  const now = new Date("2026-09-19T05:00:00+09:00");
  const skeleton = buildAbsenceSkeleton({
    lifestyle: context.lifestyle,
    timeZone: context.world.timezone,
    lastLoginAt,
    now,
  });
  const request = { lastLoginAt: lastLoginAt.toISOString(), now: now.toISOString() };
  const sleepSlot = skeleton.actionSlots.find((s) => s.activity === "就寝");

  it("test setup produces a 就寝 slot", () => {
    expect(sleepSlot).toBeDefined();
  });

  it("fails when the sleep slot's action mentions a forbidden word", () => {
    const scenario = makeScenario({ function: "absenceSimulator", request });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: {
        events: [],
        actions: skeleton.actionSlots.map((slot) => ({
          startDatetime: slot.startDatetime,
          endDatetime: slot.endDatetime,
          action: slot.activity === "就寝" ? "朝ごはんを食べた" : "友達と話してた",
          memo: "",
        })),
      },
    });
    const outcome = slotActionMustNotContain(
      result,
      makeContext({ resolvedScenario: scenario }),
      { activityIncludes: "就寝", words: ["朝ごはん", "食べた"] }
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain(sleepSlot!.startDatetime);
  });

  it("passes when the sleep slot's action does not mention forbidden words", () => {
    const scenario = makeScenario({ function: "absenceSimulator", request });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: {
        events: [],
        actions: skeleton.actionSlots.map((slot) => ({
          startDatetime: slot.startDatetime,
          endDatetime: slot.endDatetime,
          action: slot.activity === "就寝" ? "ぐっすり眠っていた" : "友達と話してた",
          memo: "",
        })),
      },
    });
    const outcome = slotActionMustNotContain(
      result,
      makeContext({ resolvedScenario: scenario }),
      { activityIncludes: "就寝", words: ["朝ごはん", "食べた"] }
    );
    expect(outcome.passed).toBe(true);
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({ function: "absenceSimulator", output: { events: [], actions: [] } });
    expect(slotActionMustNotContain(result, context, { activityIncludes: "就寝" }).passed).toBe(false);
    expect(slotActionMustNotContain(result, context, { words: ["x"] }).passed).toBe(false);
  });
});

describe("noRepeatOfRecentEvents", () => {
  const recentState = {
    absenceRecords: [baseAbsenceRecordItem({ events: [{ kind: "daily", summary: "友達と公園で遊んだ", detail: "d" }] })],
  };

  it("fails when a new event is very similar to a recent one", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", state: recentState }) });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [{ kind: "daily", summary: "友達と公園で遊んだよ", detail: "d" }], actions: [] },
    });
    const outcome = noRepeatOfRecentEvents(result, context, undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("友達と公園で遊んだ");
  });

  it("passes when the new event is dissimilar", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", state: recentState }) });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [{ kind: "daily", summary: "新しいカフェでケーキを食べた", detail: "d" }], actions: [] },
    });
    expect(noRepeatOfRecentEvents(result, context, undefined).passed).toBe(true);
  });

  it("respects a custom threshold", () => {
    const context = makeContext({ resolvedScenario: makeScenario({ function: "absenceSimulator", state: recentState }) });
    const result = makeRunResult({
      function: "absenceSimulator",
      output: { events: [{ kind: "daily", summary: "新しいカフェでケーキを食べた", detail: "d" }], actions: [] },
    });
    expect(noRepeatOfRecentEvents(result, context, { threshold: 0 }).passed).toBe(false);
  });
});

describe("noDuplicateThreads", () => {
  it("fails when two open threads have similar topics", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      writes: [
        {
          table: "events",
          operation: "put",
          item: toWriteItem(baseAbsenceRecordItem({
            threads: [
              { id: "t1", topic: "文化祭の準備について", status: "open", openedAt: "2026-09-18T00:00:00.000Z" },
              { id: "t2", topic: "文化祭の準備の進み具合について", status: "open", openedAt: "2026-09-18T01:00:00.000Z" },
            ],
          })),
        },
      ],
    });
    const outcome = noDuplicateThreads(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("文化祭");
  });

  it("passes when open threads are dissimilar", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      writes: [
        {
          table: "events",
          operation: "put",
          item: toWriteItem(baseAbsenceRecordItem({
            threads: [
              { id: "t1", topic: "文化祭の準備について", status: "open", openedAt: "2026-09-18T00:00:00.000Z" },
              { id: "t2", topic: "飼っている猫の体調", status: "open", openedAt: "2026-09-18T01:00:00.000Z" },
            ],
          })),
        },
      ],
    });
    expect(noDuplicateThreads(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when the events-table write is missing", () => {
    const result = makeRunResult({ function: "absenceSimulator", writes: [] });
    expect(noDuplicateThreads(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("threadContinued", () => {
  const withThreadEvent = makeRunResult({
    function: "absenceSimulator",
    writes: [
      {
        table: "events",
        operation: "put",
        item: toWriteItem(baseAbsenceRecordItem({
          threads: [{ id: "t1", topic: "文化祭の準備について", status: "open", openedAt: "2026-09-18T00:00:00.000Z" }],
          events: [{ kind: "daily", summary: "衣装の続きをした", detail: "d", threadId: "t1" }],
        })),
      },
    ],
  });

  it("passes when an event carries the matching thread id", () => {
    expect(threadContinued(withThreadEvent, makeContext(), { threadTopicIncludes: "文化祭" }).passed).toBe(true);
  });

  it("fails when no thread matches the topic text", () => {
    const outcome = threadContinued(withThreadEvent, makeContext(), { threadTopicIncludes: "海外旅行" });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("海外旅行");
  });

  it("fails when a matching thread exists but no event references it", () => {
    const result = makeRunResult({
      function: "absenceSimulator",
      writes: [
        {
          table: "events",
          operation: "put",
          item: toWriteItem(baseAbsenceRecordItem({
            threads: [{ id: "t1", topic: "文化祭の準備について", status: "open", openedAt: "2026-09-18T00:00:00.000Z" }],
            events: [{ kind: "daily", summary: "別の話", detail: "d" }],
          })),
        },
      ],
    });
    expect(threadContinued(result, makeContext(), { threadTopicIncludes: "文化祭" }).passed).toBe(false);
  });

  it("fails for invalid params", () => {
    expect(threadContinued(withThreadEvent, makeContext(), { threadTopicIncludes: "" }).passed).toBe(false);
    expect(threadContinued(withThreadEvent, makeContext(), {}).passed).toBe(false);
  });
});
