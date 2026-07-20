// -------------------------------------------------------
// actionPlanner
// eventResolver の結果を受け取り、不在時間分（上限12時間）の
// キャラクターの行動履歴を Bedrock で生成する。
// DynamoDB には保存しない（memoryRetriever に引き渡す）。
// -------------------------------------------------------

import Mustache from "mustache";

import PROMPT_TEMPLATE from "./prompts/actionPlanner.mustache";
import { invokeModelJson } from "../lib/bedrock.js";
import { getMemories } from "../lib/dynamo.js";
import type {
  Action,
  ActionPlannerResult,
  EventResolverResult,
  NormalizedRequest,
} from "../types.js";

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runActionPlanner(
  req: NormalizedRequest,
  eventResult: EventResolverResult
): Promise<ActionPlannerResult> {
  console.log("[actionPlanner] start");

  const { profile, lastLoginAt, now } = req;

  // 不在時間（上限12時間）
  const elapsedMs = Math.min(
    now.getTime() - lastLoginAt.getTime(),
    12 * 60 * 60 * 1000
  );
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsed = `${elapsedHours}時間`;

  // 行動期間の開始・終了（now から elapsedMs 前〜now）
  const actionStart = new Date(now.getTime() - elapsedMs).toISOString();
  const actionEnd = now.toISOString();

  // 発生イベントをプロンプト用テキストに変換
  const eventsText =
    eventResult.events.length > 0
      ? eventResult.events.map((e, i) => `${i + 1}. ${e}`).join("\n")
      : "（なし）";

  // 重要記憶を取得
  const memories = await getMemories(profile.name);
  const memoriesText =
    memories.length > 0
      ? memories
          .map(
            (m) =>
              `・${m.eventSummary ?? ""}${m.characterInterpretation ? "（" + m.characterInterpretation + "）" : ""}`
          )
          .join("\n")
      : "（なし）";

  const systemPrompt = Mustache.render(PROMPT_TEMPLATE, {
    name: profile.name,
    personality: profile.personality,
    startDatetime: actionStart,
    endDatetime: actionEnd,
    elapsed,
    eventsText,
    memoriesText,
  });

  const fallback: ActionPlannerResult = { actions: [] };
  const result = await invokeModelJson<ActionPlannerResult>(
    systemPrompt,
    "不在期間中の行動履歴を生成してください。",
    fallback
  );

  const actions: Action[] = Array.isArray(result.actions) ? result.actions : [];
  console.log(`[actionPlanner] generated ${actions.length} actions`);

  return { actions };
}
