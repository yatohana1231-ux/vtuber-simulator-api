import { describe, expect, it } from "vitest";
import { deltaDirection, deltaWithin } from "./emotionUpdater.js";
import { makeContext, makeRunResult, makeScenario } from "./fixtures.js";
import { DEFAULT_MOOD, DEFAULT_PERCEPTION } from "../../../../src/lib/dynamo.js";

describe("deltaDirection", () => {
  it("passes when directions match the actual delta", () => {
    const context = makeContext({
      resolvedScenario: makeScenario({ function: "emotionUpdater", request: { process: 2, playerMessage: "嬉しいね" } }),
    });
    const result = makeRunResult({
      function: "emotionUpdater",
      output: {
        mood: { ...DEFAULT_MOOD, joy: DEFAULT_MOOD.joy + 5 },
        perception: { ...DEFAULT_PERCEPTION, trust: DEFAULT_PERCEPTION.trust },
      },
    });
    const outcome = deltaDirection(result, context, { expect: { "mood.joy": "up", "perception.trust": "flat" } });
    expect(outcome.passed).toBe(true);
  });

  it("fails when a direction does not match", () => {
    const context = makeContext({
      resolvedScenario: makeScenario({ function: "emotionUpdater", request: { process: 2, playerMessage: "つらい" } }),
    });
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD, joy: DEFAULT_MOOD.joy - 5 }, perception: { ...DEFAULT_PERCEPTION } },
    });
    const outcome = deltaDirection(result, context, { expect: { "mood.joy": "up" } });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("mood.joy");
  });

  it("uses scenario.state as the baseline when provided", () => {
    const context = makeContext({
      resolvedScenario: makeScenario({
        function: "emotionUpdater",
        request: { process: 2, playerMessage: "x" },
        state: { mood: { ...DEFAULT_MOOD, joy: 10 } },
      }),
    });
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD, joy: 20 }, perception: { ...DEFAULT_PERCEPTION } },
    });
    expect(deltaDirection(result, context, { expect: { "mood.joy": "up" } }).passed).toBe(true);
  });

  it("fails for invalid params.expect", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } },
    });
    expect(deltaDirection(result, makeContext(), undefined).passed).toBe(false);
    expect(deltaDirection(result, makeContext(), { expect: { "mood.joy": "sideways" } }).passed).toBe(false);
    expect(deltaDirection(result, makeContext(), { expect: { unknownGroup: "up" } }).passed).toBe(false);
  });

  it("fails when output has no mood/perception", () => {
    const result = makeRunResult({ function: "emotionUpdater", output: {} });
    expect(deltaDirection(result, makeContext(), { expect: { "mood.joy": "up" } }).passed).toBe(false);
  });
});

describe("deltaWithin", () => {
  it("passes when all deltas are within the max", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD, joy: DEFAULT_MOOD.joy + 3 }, perception: { ...DEFAULT_PERCEPTION } },
    });
    expect(deltaWithin(result, makeContext(), { path: "mood", max: 5 }).passed).toBe(true);
  });

  it("fails when a delta exceeds the max", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD, joy: DEFAULT_MOOD.joy + 10 }, perception: { ...DEFAULT_PERCEPTION } },
    });
    const outcome = deltaWithin(result, makeContext(), { path: "mood", max: 5 });
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("mood.joy");
  });

  it("fails for invalid params", () => {
    const result = makeRunResult({
      function: "emotionUpdater",
      output: { mood: { ...DEFAULT_MOOD }, perception: { ...DEFAULT_PERCEPTION } },
    });
    expect(deltaWithin(result, makeContext(), { path: "mood" }).passed).toBe(false);
    expect(deltaWithin(result, makeContext(), { path: "unknown", max: 5 }).passed).toBe(false);
  });
});
