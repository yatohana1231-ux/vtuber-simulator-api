import { describe, expect, it } from "vitest";
import { jsonParsed, modelResponded, noModelCall } from "./common.js";
import { runChecks } from "./index.js";
import { makeContext, makeModelCall, makeRunResult, makeScenario } from "./fixtures.js";

describe("modelResponded", () => {
  it("passes when there is at least one call without error", () => {
    const result = makeRunResult({ modelCalls: [makeModelCall()] });
    expect(modelResponded(result, makeContext(), undefined)).toEqual({ passed: true });
  });

  it("fails when there is no call", () => {
    const result = makeRunResult({ modelCalls: [] });
    const outcome = modelResponded(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toBeTruthy();
  });

  it("fails when a call recorded an error", () => {
    const result = makeRunResult({ modelCalls: [makeModelCall({ error: "Throttled" })] });
    const outcome = modelResponded(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("Throttled");
  });
});

describe("jsonParsed", () => {
  it("passes for a fenced json block", () => {
    const result = makeRunResult({
      modelCalls: [makeModelCall({ responseText: '```json\n{"a":1}\n```' })],
    });
    expect(jsonParsed(result, makeContext(), undefined).passed).toBe(true);
  });

  it("passes for a bare json object", () => {
    const result = makeRunResult({
      modelCalls: [makeModelCall({ responseText: 'text before {"a":1} text after' })],
    });
    expect(jsonParsed(result, makeContext(), undefined).passed).toBe(true);
  });

  it("fails when there is no json block", () => {
    const result = makeRunResult({
      modelCalls: [makeModelCall({ responseText: "no json here" })],
    });
    const outcome = jsonParsed(result, makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toBeTruthy();
  });

  it("fails when json is malformed", () => {
    const result = makeRunResult({
      modelCalls: [makeModelCall({ responseText: "```json\n{not valid}\n```" })],
    });
    expect(jsonParsed(result, makeContext(), undefined).passed).toBe(false);
  });

  it("fails when there is no call", () => {
    const result = makeRunResult({ modelCalls: [] });
    expect(jsonParsed(result, makeContext(), undefined).passed).toBe(false);
  });
});

describe("noModelCall", () => {
  it("passes when there are no calls", () => {
    expect(noModelCall(makeRunResult({ modelCalls: [] }), makeContext(), undefined).passed).toBe(true);
  });

  it("fails when there is a call", () => {
    const outcome = noModelCall(makeRunResult({ modelCalls: [makeModelCall()] }), makeContext(), undefined);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("1");
  });
});

describe("runChecks (dispatch)", () => {
  it("fails every check with the error detail when result.error is set", () => {
    const scenario = makeScenario({ checks: [{ type: "modelResponded" }, { type: "noModelCall" }] });
    const result = makeRunResult({ error: "boom", modelCalls: [makeModelCall()] });
    const results = runChecks(scenario, result, makeContext());
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.passed).toBe(false);
      expect(r.detail).toContain("boom");
    }
  });

  it("fails unknown check types without throwing", () => {
    const scenario = makeScenario({ checks: [{ type: "notARealCheck" }] });
    const result = makeRunResult({ modelCalls: [makeModelCall()] });
    const results = runChecks(scenario, result, makeContext());
    expect(results).toEqual([
      { type: "notARealCheck", passed: false, detail: "unknown check type" },
    ]);
  });

  it("runs registered checks and preserves order", () => {
    const scenario = makeScenario({
      checks: [{ type: "noModelCall" }, { type: "modelResponded" }],
    });
    const result = makeRunResult({ modelCalls: [makeModelCall()] });
    const results = runChecks(scenario, result, makeContext());
    expect(results.map((r) => r.type)).toEqual(["noModelCall", "modelResponded"]);
    expect(results[0].passed).toBe(false); // noModelCall: there IS a call
    expect(results[1].passed).toBe(true); // modelResponded: there IS a call
  });
});
