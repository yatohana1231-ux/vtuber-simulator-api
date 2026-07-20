// -------------------------------------------------------
// eventResolver
// プレイヤー不在期間中にキャラクターが経験したイベントを
// Bedrock で生成し、events テーブルに保存する。
// -------------------------------------------------------

import { randomUUID } from "crypto";
import Mustache from "mustache";

import PROMPT_TEMPLATE from "./prompts/eventResolver.mustache";
import { invokeModelJson } from "../lib/bedrock.js";
import { getMemories, saveEvent } from "../lib/dynamo.js";
import type {
  EventResolverResult,
  NormalizedRequest,
} from "../types.js";

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runEventResolver(
  req: NormalizedRequest
): Promise<EventResolverResult> {
  console.log("[eventResolver] start");

  const { profile, lastLoginAt, now } = req;

  const startDatetime = lastLoginAt.toISOString();
  const endDatetime = now.toISOString();
  const elapsedMs = now.getTime() - lastLoginAt.getTime();
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedMinutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
  const elapsed = `${elapsedHours}時間${elapsedMinutes > 0 ? elapsedMinutes + "分" : ""}`;

  // 重要記憶を取得してプロンプトに渡す
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
    startDatetime,
    endDatetime,
    elapsed,
    memoriesText,
  });

  const fallback = { events: [] };
  const result = await invokeModelJson<{ events: string[] }>(
    systemPrompt,
    "不在期間中の出来事を生成してください。",
    fallback
  );

  const eventResult: EventResolverResult = {
    UUID: randomUUID(),
    startDatetime,
    endDatetime,
    elapsed,
    events: result.events ?? [],
  };

  // events テーブルに保存
  await saveEvent({
    event_id: eventResult.UUID,
    characterId: req.characterId,
    startDatetime: eventResult.startDatetime,
    endDatetime: eventResult.endDatetime,
    elapsed: eventResult.elapsed,
    events: eventResult.events,
    createdAt: new Date().toISOString(),
  });

  console.log(`[eventResolver] generated ${eventResult.events.length} events`);
  return eventResult;
}
