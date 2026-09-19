import { describe, it, expect } from "vitest";
import { getModelProfile } from "../../../src/lib/modelProfiles.js";

describe("getModelProfile", () => {
  it.each([
    "amazon.nova-lite-v1:0",
    "apac.amazon.nova-lite-v1:0",
    "jp.amazon.nova-2-lite-v1:0",
    "global.amazon.nova-2-lite-v1:0",
    "apac.amazon.nova-pro-v1:0",
  ])("Novaのモデル(%s) → supportsTopPがtrue", (modelId) => {
    expect(getModelProfile(modelId).supportsTopP).toBe(true);
  });

  it.each([
    "anthropic.claude-3-haiku-20240307-v1:0",
    "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    "jp.anthropic.claude-sonnet-4-6",
    "global.anthropic.claude-sonnet-5",
  ])("Claudeのモデル(%s) → supportsTopPがfalse", (modelId) => {
    expect(getModelProfile(modelId).supportsTopP).toBe(false);
  });

  it("未知のモデルID → supportsTopPがfalse（安全側）", () => {
    expect(getModelProfile("openai.gpt-oss-120b").supportsTopP).toBe(false);
  });
});
