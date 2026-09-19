// -------------------------------------------------------
// 4機能に共通のルールによる判定。
// -------------------------------------------------------

import type { CheckFn } from "./types.js";
import { extractJsonFromText } from "./text.js";

/** Bedrock の呼び出しが1回以上あり、どの呼び出しも例外を起こしていない */
export const modelResponded: CheckFn = (result) => {
  if (result.modelCalls.length === 0) {
    return { passed: false, detail: "Bedrock の呼び出しが無い" };
  }
  const errored = result.modelCalls.filter((c) => c.error);
  if (errored.length > 0) {
    return {
      passed: false,
      detail: `呼び出しで例外が起きた: ${errored.map((c) => c.error).join(" / ")}`,
    };
  }
  return { passed: true };
};

/** 最後の Bedrock 応答テキストから、invokeModelJson と同じ方法で JSON が読める */
export const jsonParsed: CheckFn = (result) => {
  const lastCall = result.modelCalls[result.modelCalls.length - 1];
  if (!lastCall) {
    return { passed: false, detail: "Bedrock の呼び出しが無い" };
  }
  const parsed = extractJsonFromText(lastCall.responseText);
  return parsed.ok ? { passed: true } : { passed: false, detail: parsed.reason };
};

/** Bedrock を呼んでいない（process=1 で記録が無いときなど、呼ばないのが正しいシナリオ用） */
export const noModelCall: CheckFn = (result) => {
  const passed = result.modelCalls.length === 0;
  return {
    passed,
    detail: passed ? undefined : `Bedrock を ${result.modelCalls.length} 回呼んでいる`,
  };
};
