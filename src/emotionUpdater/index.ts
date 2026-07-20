// -------------------------------------------------------
// emotionUpdater
// イベント・アクション（プロセス1）またはプレイヤー発言（プロセス2）を
// インプットとしてキャラクターの感情値・関係値を更新する。
// -------------------------------------------------------

import Mustache from "mustache";

import PROMPT_TEMPLATE from "./prompts/emotionUpdater.mustache";
import { invokeModelJson } from "../lib/bedrock.js";
import {
  getCharacterState,
  saveCharacterState,
  DEFAULT_MOOD,
  DEFAULT_PERCEPTION,
} from "../lib/dynamo.js";
import { clamp } from "../lib/utils.js";
import type {
  Action,
  Mood,
  NormalizedRequest,
  Perception,
} from "../types.js";

// -------------------------------------------------------
// 引数型
// -------------------------------------------------------

interface EmotionUpdaterProcess1Args {
  req: NormalizedRequest;
  process: 1;
  events: string[];
  actions: Action[];
  playerMessage?: never;
}

interface EmotionUpdaterProcess2Args {
  req: NormalizedRequest;
  process: 2;
  playerMessage: string;
  events?: never;
  actions?: never;
}

type EmotionUpdaterArgs = EmotionUpdaterProcess1Args | EmotionUpdaterProcess2Args;

interface EmotionUpdaterResult {
  mood: Mood;
  perception: Perception;
}

// -------------------------------------------------------
// ラベルマップ
// -------------------------------------------------------

const MOOD_LABELS: Record<keyof Mood, string> = {
  joy: "喜び",
  anxiety: "不安",
  angry: "怒り",
  fatigue: "疲労",
  confidence: "自信",
  loneliness: "孤独感",
};

const PERCEPTION_LABELS: Record<keyof Perception, string> = {
  trust: "信頼",
  affection: "好感",
  respect: "尊敬",
  fear: "恐れ",
  dependence: "依存",
  familiarity: "親しみ",
};

function toLabel(value: number): string {
  if (value <= 20) return "ほとんど感じない";
  if (value <= 40) return "低い";
  if (value <= 60) return "標準";
  if (value <= 80) return "自覚している";
  return "強く感じる";
}

function formatState(
  obj: Record<string, number>,
  labels: Record<string, string>
): string {
  return Object.entries(obj)
    .map(([k, v]) => `・${labels[k] ?? k}：${v}（${toLabel(v)}）`)
    .join("\n");
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

export async function runEmotionUpdater(
  args: EmotionUpdaterArgs
): Promise<EmotionUpdaterResult> {
  console.log(`[emotionUpdater] start process=${args.process}`);

  const { req } = args;
  const { mood: currentMood, perception: currentPerception } =
    await getCharacterState(req.characterId);

  // インプットテキストを組み立てる
  let inputText: string;
  let perceptionRule: string;

  if (args.process === 1) {
    // プロセス1: イベント・アクションがインプット
    const eventsText =
      args.events.length > 0
        ? args.events.map((e, i) => `${i + 1}. ${e}`).join("\n")
        : "（なし）";
    const actionsText =
      args.actions.length > 0
        ? args.actions
            .map(
              (a) =>
                `・${a.startDatetime.slice(0, 16)} 〜 ${a.endDatetime.slice(0, 16)}: ${a.action}（${a.memo}）`
            )
            .join("\n")
        : "（なし）";

    inputText = `【不在中の出来事】\n${eventsText}\n\n【不在中の行動】\n${actionsText}`;
    perceptionRule =
      "- 関係値（perception）はプレイヤー不在中の出来事なので、大きく変化しないよう差分を小さく抑えること（目安: ±0〜3）";
  } else {
    // プロセス2: プレイヤー発言がインプット
    inputText = `【プレイヤーの発言】\n${args.playerMessage}`;
    perceptionRule =
      "- 関係値（perception）もプレイヤーの発言に応じて適切に更新する（目安: ±1〜5）";
  }

  const moodText = formatState(currentMood as unknown as Record<string, number>, MOOD_LABELS as Record<string, string>);
  const perceptionText = formatState(currentPerception as unknown as Record<string, number>, PERCEPTION_LABELS as Record<string, string>);

  const systemPrompt = Mustache.render(PROMPT_TEMPLATE, {
    name: req.profile.name,
    personality: req.profile.personality,
    moodText,
    perceptionText,
    inputText,
    perceptionRule,
  });

  const fallback = { moodDelta: {}, perceptionDelta: {} };
  const delta = await invokeModelJson<{
    moodDelta: Partial<Record<keyof Mood, number>>;
    perceptionDelta: Partial<Record<keyof Perception, number>>;
  }>(systemPrompt, "感情値・関係値の差分を算出してください。", fallback);

  // 差分を適用して 1〜100 にクランプ
  const updatedMood = applyMoodDelta(currentMood, delta.moodDelta ?? {});
  const updatedPerception = applyPerceptionDelta(currentPerception, delta.perceptionDelta ?? {});

  // DynamoDB に保存
  await saveCharacterState(req.characterId, updatedMood, updatedPerception);

  console.log("[emotionUpdater] updated mood:", JSON.stringify(updatedMood));
  console.log("[emotionUpdater] updated perception:", JSON.stringify(updatedPerception));

  return { mood: updatedMood, perception: updatedPerception };
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

function applyMoodDelta(
  current: Mood,
  delta: Partial<Record<keyof Mood, number>>
): Mood {
  return {
    joy:        clamp((current.joy        ?? DEFAULT_MOOD.joy)        + (delta.joy        ?? 0)),
    anxiety:    clamp((current.anxiety    ?? DEFAULT_MOOD.anxiety)    + (delta.anxiety    ?? 0)),
    angry:      clamp((current.angry      ?? DEFAULT_MOOD.angry)      + (delta.angry      ?? 0)),
    fatigue:    clamp((current.fatigue    ?? DEFAULT_MOOD.fatigue)    + (delta.fatigue    ?? 0)),
    confidence: clamp((current.confidence ?? DEFAULT_MOOD.confidence) + (delta.confidence ?? 0)),
    loneliness: clamp((current.loneliness ?? DEFAULT_MOOD.loneliness) + (delta.loneliness ?? 0)),
  };
}

function applyPerceptionDelta(
  current: Perception,
  delta: Partial<Record<keyof Perception, number>>
): Perception {
  return {
    trust:      clamp((current.trust      ?? DEFAULT_PERCEPTION.trust)      + (delta.trust      ?? 0)),
    affection:  clamp((current.affection  ?? DEFAULT_PERCEPTION.affection)  + (delta.affection  ?? 0)),
    respect:    clamp((current.respect    ?? DEFAULT_PERCEPTION.respect)    + (delta.respect    ?? 0)),
    fear:       clamp((current.fear       ?? DEFAULT_PERCEPTION.fear)       + (delta.fear       ?? 0)),
    dependence: clamp((current.dependence ?? DEFAULT_PERCEPTION.dependence) + (delta.dependence ?? 0)),
    familiarity:clamp((current.familiarity ?? DEFAULT_PERCEPTION.familiarity) + (delta.familiarity ?? 0)),
  };
}
