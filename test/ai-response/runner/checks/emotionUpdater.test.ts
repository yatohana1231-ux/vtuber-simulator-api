import { describe, expect, it } from "vitest";
import {
  appraisalCause,
  appraisalCount,
  emotionNotTriggered,
  emotionTriggered,
  getParsedModelOutput,
  interactionLabel,
  moodDirection,
  pendingContribution,
  pendingSessionUntouched,
  perceptionSettled,
  perceptionUnchanged,
} from "./emotionUpdater.js";
import { makeAffectState, makeContext, makeModelCall, makeRunResult, makeScenario } from "./fixtures.js";
import type { PendingSession } from "../../../../src/types.js";

// D-040 フェーズ16b: emotionUpdater の判定は、RunResult.preAffectState/postAffectState
// （execute.ts が組み立てる、実行前後の完全な状態）と、LLM が出した評価（Bedrock の最後の応答から
// 読み、parseEmotionUpdaterModelOutput で検証したもの）を見る。

const TWO_APPRAISALS_RESPONSE = JSON.stringify({
  appraisals: [
    {
      summary: "配信を褒められた",
      desirabilityForSelf: 2,
      desirabilityForPlayer: 0,
      prospect: "happened",
      cause: "player",
      praiseworthiness: 1,
    },
    {
      summary: "マイクの調子が悪かった",
      desirabilityForSelf: -1,
      desirabilityForPlayer: 0,
      prospect: "happened",
      cause: "circumstance",
      praiseworthiness: 0,
    },
  ],
  interaction: {
    playerSelfDisclosure: "none",
    responseToCharacterDisclosure: "responsive",
    helpedCharacter: false,
    rememberedPastTopic: false,
  },
});

function makePending(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    startedAt: "2026-09-19T00:00:00.000Z",
    lastMessageAt: "2026-09-19T00:00:00.000Z",
    messageCount: 1,
    peak: {},
    last: {},
    ...overrides,
  };
}

function process2Context() {
  return makeContext({ resolvedScenario: makeScenario({ function: "emotionUpdater", request: { process: 2, playerMessage: "x" } }) });
}

function process1Context() {
  return makeContext({ resolvedScenario: makeScenario({ function: "emotionUpdater", request: { process: 1 } }) });
}

describe("emotionTriggered", () => {
  it("passes when a listed emotion rose by 1 or more", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, joy: 0 } }),
      postAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, joy: 10 } }),
    });
    expect(emotionTriggered(result, makeContext(), { anyOf: ["joy"] }).passed).toBe(true);
  });

  it("fails when no listed emotion rose by 1 or more", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, joy: 5 } }),
      postAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, joy: 5.5 } }),
    });
    expect(emotionTriggered(result, makeContext(), { anyOf: ["joy"] }).passed).toBe(false);
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    const outcome = emotionTriggered(result, makeContext(), { anyOf: ["joy"] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("postAffectState");
  });

  it("fails for invalid params.anyOf", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: makeAffectState() });
    expect(emotionTriggered(result, makeContext(), { anyOf: [] }).passed).toBe(false);
    expect(emotionTriggered(result, makeContext(), { anyOf: ["notAnEmotion"] }).passed).toBe(false);
    expect(emotionTriggered(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("emotionNotTriggered", () => {
  it("passes when none of the listed emotions rose", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, anger: 0 } }),
      postAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, anger: 0 } }),
    });
    expect(emotionNotTriggered(result, makeContext(), { noneOf: ["anger", "sadness"] }).passed).toBe(true);
  });

  it("fails when a listed emotion rose by 1 or more", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, anger: 0 } }),
      postAffectState: makeAffectState({ emotions: { ...makeAffectState().emotions, anger: 8 } }),
    });
    const outcome = emotionNotTriggered(result, makeContext(), { noneOf: ["anger"] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("anger");
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(emotionNotTriggered(result, makeContext(), { noneOf: ["anger"] }).passed).toBe(false);
  });
});

describe("moodDirection", () => {
  it("passes when the axis directions match (including flat within 0.5)", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ mood: { pleasure: 0, arousal: 0, dominance: 0 } }),
      postAffectState: makeAffectState({ mood: { pleasure: 20, arousal: 0.2, dominance: 0 } }),
    });
    const outcome = moodDirection(result, makeContext(), { expect: { pleasure: "up", arousal: "flat", dominance: "flat" } });
    expect(outcome.passed).toBe(true);
  });

  it("fails when a direction does not match", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ mood: { pleasure: 0, arousal: 0, dominance: 0 } }),
      postAffectState: makeAffectState({ mood: { pleasure: -20, arousal: 0, dominance: 0 } }),
    });
    const outcome = moodDirection(result, makeContext(), { expect: { pleasure: "up" } });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("pleasure");
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(moodDirection(result, makeContext(), { expect: { pleasure: "up" } }).passed).toBe(false);
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: makeAffectState() });
    expect(moodDirection(result, makeContext(), undefined).passed).toBe(false);
    expect(moodDirection(result, makeContext(), { expect: { unknownAxis: "up" } }).passed).toBe(false);
    expect(moodDirection(result, makeContext(), { expect: { pleasure: "sideways" } }).passed).toBe(false);
  });
});

describe("appraisalCount", () => {
  it("passes when the parsed appraisal count is within range", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCount(result, process1Context(), { min: 1, max: 3 }).passed).toBe(true);
  });

  it("fails when the count is out of range", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCount(result, process1Context(), { max: 1 }).passed).toBe(false);
  });

  it("fails when there is no model call", () => {
    const result = makeRunResult({ function: "emotionUpdater", modelCalls: [] });
    const outcome = appraisalCount(result, process1Context(), { max: 3 });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("Bedrock");
  });

  it("fails when the response has no readable JSON", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: "not json at all" })],
    });
    expect(appraisalCount(result, process1Context(), { max: 3 }).passed).toBe(false);
  });
});

describe("appraisalCause", () => {
  it("anyOf: passes when some appraisal has one of the listed causes", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCause(result, process1Context(), { anyOf: ["player"] }).passed).toBe(true);
  });

  it("anyOf: fails when no appraisal has any of the listed causes", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCause(result, process1Context(), { anyOf: ["self"] }).passed).toBe(false);
  });

  it("noneOf: fails when an appraisal has a forbidden cause", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    const outcome = appraisalCause(result, process1Context(), { noneOf: ["player"] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("player");
  });

  it("noneOf: passes when no appraisal has a forbidden cause", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCause(result, process1Context(), { noneOf: ["self"] }).passed).toBe(true);
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(appraisalCause(result, process1Context(), {}).passed).toBe(false);
  });
});

describe("interactionLabel", () => {
  it("passes when the field's value is one of the expected values", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    const outcome = interactionLabel(result, process2Context(), {
      field: "responseToCharacterDisclosure",
      expect: ["responsive"],
    });
    expect(outcome.passed).toBe(true);
  });

  it("fails when the field's value is not one of the expected values", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    const outcome = interactionLabel(result, process2Context(), {
      field: "responseToCharacterDisclosure",
      expect: ["dismissive"],
    });
    expect(outcome.passed).toBe(false);
  });

  it("fails for process=1 (interaction is null)", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    const outcome = interactionLabel(result, process1Context(), { field: "helpedCharacter", expect: [false] });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("interaction");
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    expect(interactionLabel(result, process2Context(), { field: "unknownField", expect: ["x"] }).passed).toBe(false);
    expect(interactionLabel(result, process2Context(), { field: "helpedCharacter", expect: [] }).passed).toBe(false);
  });
});

describe("getParsedModelOutput", () => {
  it("returns the parsed output when the response has readable JSON", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      modelCalls: [makeModelCall({ responseText: TWO_APPRAISALS_RESPONSE })],
    });
    const parsed = getParsedModelOutput(result, process2Context());
    expect(parsed?.appraisals).toHaveLength(2);
    expect(parsed?.interaction?.responseToCharacterDisclosure).toBe("responsive");
  });

  it("returns null when there is no model call", () => {
    const result = makeRunResult({ function: "emotionUpdater", modelCalls: [] });
    expect(getParsedModelOutput(result, process1Context())).toBeNull();
  });
});

describe("pendingContribution", () => {
  it("passes when the axis directions of pendingSession.last match", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      postAffectState: makeAffectState({ pendingSession: makePending({ last: { trust: 2, affection: 0 } }) }),
    });
    expect(pendingContribution(result, makeContext(), { expect: { trust: "up", affection: "flat" } }).passed).toBe(true);
  });

  it("fails when a direction does not match", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      postAffectState: makeAffectState({ pendingSession: makePending({ last: { trust: -2 } }) }),
    });
    const outcome = pendingContribution(result, makeContext(), { expect: { trust: "up" } });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("trust");
  });

  it("fails when pendingSession is absent", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: makeAffectState({ pendingSession: null }) });
    const outcome = pendingContribution(result, makeContext(), { expect: { trust: "up" } });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("pendingSession");
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(pendingContribution(result, makeContext(), { expect: { trust: "up" } }).passed).toBe(false);
  });
});

describe("pendingSessionUntouched", () => {
  it("passes when pendingSession is unchanged", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ pendingSession: null }),
      postAffectState: makeAffectState({ pendingSession: null }),
    });
    expect(pendingSessionUntouched(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when pendingSession changed", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ pendingSession: null }),
      postAffectState: makeAffectState({ pendingSession: makePending() }),
    });
    expect(pendingSessionUntouched(result, makeContext(), undefined).passed).toBe(false);
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(pendingSessionUntouched(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("perceptionUnchanged", () => {
  it("passes when perception is unchanged", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception }),
      postAffectState: makeAffectState({ perception: { ...perception } }),
    });
    expect(perceptionUnchanged(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when perception changed", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception }),
      postAffectState: makeAffectState({ perception: { ...perception, trust: perception.trust + 1 } }),
    });
    const outcome = perceptionUnchanged(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("trust");
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(perceptionUnchanged(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("perceptionSettled", () => {
  it("passes when a session settled (pendingSession -> null) and perception moved as expected", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception, pendingSession: makePending() }),
      postAffectState: makeAffectState({
        perception: { ...perception, trust: perception.trust + 2, affection: perception.affection + 1 },
        pendingSession: null,
      }),
    });
    const outcome = perceptionSettled(result, makeContext(), { expect: { trust: "up", affection: "up" }, max: 10 });
    expect(outcome.passed).toBe(true);
  });

  it("passes when a session settled into a new session (different startedAt)", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({
        perception,
        pendingSession: makePending({ startedAt: "2026-09-19T00:00:00.000Z" }),
      }),
      postAffectState: makeAffectState({
        perception: { ...perception, trust: perception.trust + 2 },
        pendingSession: makePending({ startedAt: "2026-09-19T01:00:00.000Z" }),
      }),
    });
    expect(perceptionSettled(result, makeContext(), { expect: { trust: "up" } }).passed).toBe(true);
  });

  it("fails when there was no pending session to settle", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception, pendingSession: null }),
      postAffectState: makeAffectState({ perception, pendingSession: null }),
    });
    const outcome = perceptionSettled(result, makeContext(), { expect: { trust: "up" } });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("確定");
  });

  it("fails when the same session is still pending (not settled)", () => {
    const perception = makeAffectState().perception;
    const pending = makePending({ startedAt: "2026-09-19T00:00:00.000Z" });
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception, pendingSession: pending }),
      postAffectState: makeAffectState({ perception, pendingSession: { ...pending } }),
    });
    expect(perceptionSettled(result, makeContext(), { expect: { trust: "up" } }).passed).toBe(false);
  });

  it("fails when a direction does not match", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception, pendingSession: makePending() }),
      postAffectState: makeAffectState({
        perception: { ...perception, trust: perception.trust - 2 },
        pendingSession: null,
      }),
    });
    expect(perceptionSettled(result, makeContext(), { expect: { trust: "up" } }).passed).toBe(false);
  });

  it("fails when the delta exceeds max", () => {
    const perception = makeAffectState().perception;
    const result = makeRunResult({
      function: "emotionUpdater",
      preAffectState: makeAffectState({ perception, pendingSession: makePending() }),
      postAffectState: makeAffectState({
        perception: { ...perception, trust: perception.trust + 20 },
        pendingSession: null,
      }),
    });
    const outcome = perceptionSettled(result, makeContext(), { expect: { trust: "up" }, max: 5 });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("上限");
  });

  it("fails when postAffectState is missing", () => {
    const result = makeRunResult({ function: "emotionUpdater", postAffectState: undefined });
    expect(perceptionSettled(result, makeContext(), { expect: { trust: "up" } }).passed).toBe(false);
  });
});
