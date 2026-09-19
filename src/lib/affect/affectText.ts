// -------------------------------------------------------
// 状態（CharacterAffectState）をプロンプト用の文章にする（D-040）
//
// 気分（8象限の名前 × 強さの3段階）・活動中の情動（名前と強さのラベル）・
// 欲求（疲労・孤独感）を文章にする。世界観・キャラクターに依存する語は
// 含めない。値は丸めるのはここだけ（内部では小数のまま持つ）。
// -------------------------------------------------------

import type { AttachmentStyle, CharacterAffectState, EmotionKey } from "../../types.js";
import type { AffectConfig } from "./affectConfig.js";
import { DEFAULT_AFFECT_CONFIG } from "./affectConfig.js";
import { getActiveEmotions } from "./emotionDynamics.js";
import { describeMood, type MoodOctant } from "./moodDynamics.js";

const OCTANT_LABELS: Record<MoodOctant, string> = {
  exuberant: "はつらつとして前向き",
  bored: "退屈で気が乗らない",
  dependent: "人に甘えたい・頼りたい",
  disdainful: "冷めていて素っ気ない",
  relaxed: "くつろいで落ち着いている",
  anxious: "不安で落ち着かない",
  docile: "おだやかで素直",
  hostile: "いらだっている",
};

const MOOD_STRENGTH_LABELS: Record<"slight" | "moderate" | "strong", string> = {
  slight: "少し",
  moderate: "まあまあ",
  strong: "とても",
};

const EMOTION_LABELS: Record<EmotionKey, string> = {
  joy: "喜び",
  sadness: "悲しみ・落ち込み",
  hope: "期待",
  anxiety: "不安",
  relief: "安堵",
  disappointment: "がっかり",
  pride: "誇らしさ",
  shame: "恥ずかしさ・ふがいなさ",
  gratitude: "感謝",
  admiration: "感心",
  anger: "怒り・いらだち",
  happyFor: "相手のことを自分のことのように喜ぶ気持ち",
  sympathy: "相手を心配する気持ち",
};

/** 情動の強さのラベル（40未満「少し」、70未満「はっきり」、それ以上「強く」） */
function emotionIntensityLabel(intensity: number): string {
  if (intensity < 40) return "少し";
  if (intensity < 70) return "はっきり";
  return "強く";
}

/** 欲求のラベル（20以下「ほとんど感じない」、40以下「少し」、60以下「そこそこ」、80以下「かなり」、それより上「とても強い」） */
function needIntensityLabel(value: number): string {
  if (value <= 20) return "ほとんど感じない";
  if (value <= 40) return "少し";
  if (value <= 60) return "そこそこ";
  if (value <= 80) return "かなり";
  return "とても強い";
}

function formatMoodLine(state: CharacterAffectState, config: AffectConfig): string {
  const { octant, strength } = describeMood(state.mood, config);
  if (octant === "neutral") {
    return "・今の気分：ふつう（特に偏りはない）";
  }
  return `・今の気分：${MOOD_STRENGTH_LABELS[strength]}、${OCTANT_LABELS[octant]}`;
}

function formatEmotionLine(state: CharacterAffectState, config: AffectConfig): string {
  const active = getActiveEmotions(state.emotions, config);
  if (active.length === 0) {
    return "・いま強く感じていること：特になし";
  }
  const parts = active.map(
    ({ emotion, intensity }) => `${EMOTION_LABELS[emotion]} ${Math.round(intensity)}（${emotionIntensityLabel(intensity)}）`
  );
  return `・いま強く感じていること：${parts.join("、")}`;
}

function formatNeedLine(label: string, value: number): string {
  return `・${label}：${Math.round(value)}（${needIntensityLabel(value)}）`;
}

/** 状態を、プロンプトに載せる文章にする（気分 → 情動 → 欲求の順） */
export function formatAffectForPrompt(
  state: CharacterAffectState,
  config: AffectConfig = DEFAULT_AFFECT_CONFIG
): string {
  const lines = [
    formatMoodLine(state, config),
    formatEmotionLine(state, config),
    formatNeedLine("疲労", state.needs.fatigue),
    formatNeedLine("孤独感", state.needs.loneliness),
  ];
  return lines.join("\n");
}

const REUNION_BEHAVIOR: Record<AttachmentStyle, string> = {
  secure: "久しぶりに会えたことを素直に喜び、さみしかった気持ちも自然に伝える。",
  anxious:
    "会えなかった間の不安やさみしさが強く出る。少し拗ねたり、また来てくれるかを確かめたくなったりする。",
  avoidant: "さみしかったことを素直に言えず、平気なふりをする。ただし、言葉の端々に会えてうれしい気持ちがにじむ。",
};

/** 愛着のスタイルごとの、久しぶりに会ったときのふるまいの説明（定型文） */
export function describeReunionBehavior(style: AttachmentStyle): string {
  return REUNION_BEHAVIOR[style];
}
