// -------------------------------------------------------
// dialogueGenerator のシステムプロンプトの組み立て
//
// プロンプトキャッシュ（D-017・D-022）のため、変わる頻度ごとに層を分けて
// テンプレートファイルも分割している。
// - ① 固定部（conversation.fixed.mustache）: 同じパッケージなら毎回まったく同じ文字列。
//   段階・記録によって変わる内容（口調の例文・今の関係・日時・感情・記録・
//   長期不在フラグなど）は入れない。
// - ② セッション部（conversation.session.mustache）: 今の関係の段階（説明・話し方・
//   口調の例文。段階に例文が無ければキャラクター共通の例文）と、最新の不在期間の
//   記録（あれば続けて入れる）。段階は必ずあるので、記録が無くても空文字にはならない
//   （D-033）。
// - ③ 可変部（conversation.variable.mustache）: 現在時刻・感情・関係値・関係の履歴
//   （【これまでの関係】）・再会の備考・重要な記憶・最近の会話など、会話のたびに
//   変わる入力。
//
// D-040: mood/perception（数値6項目）を CharacterAffectState（情動・気分・欲求・関係値の層）に
// 置き換えた。再会の【備考】は longTimeFlag（廃止。D-040 で使わなくなった）ではなく、
// 孤独感（affectState.needs.loneliness）としきい値、プレイヤーの発言の有無から出す。
// -------------------------------------------------------

import Mustache from "mustache";

import FIXED_TEMPLATE from "./prompts/conversation.fixed.mustache";
import SESSION_TEMPLATE from "./prompts/conversation.session.mustache";
import VARIABLE_TEMPLATE from "./prompts/conversation.variable.mustache";
import { buildPromptContext, buildSpeechExamplesContext, PROMPT_PARTIALS } from "../promptPartials/index.js";
import { formatAbsenceRecordForPrompt } from "../lib/absenceRecordText.js";
import { formatLocalDateTime } from "../lib/timezone.js";
import { formatPerceptionForPrompt } from "../lib/characterStateText.js";
import { formatAffectForPrompt, describeReunionBehavior } from "../lib/affect/affectText.js";
import type {
  AbsenceRecord,
  CharacterAffectState,
  CharacterDefinition,
  CharacterMemoryItem,
  Perception,
  RelationshipStage,
  World,
} from "../types.js";

export interface HistoryLogForPrompt {
  role: string;
  content: string;
  index: string; // ISO8601 タイムスタンプ
}

// 再会の【備考】を出す、孤独感（0〜100）のしきい値
const REUNION_LONELINESS_THRESHOLD = 40;

export interface DialogueGeneratorPromptInput {
  world: World;
  character: CharacterDefinition;
  affectState: CharacterAffectState; // 情動・気分・欲求・関係値（now まで進めた値。D-040）
  memories: CharacterMemoryItem[];
  historyLogs: HistoryLogForPrompt[];
  latestAbsenceRecord: AbsenceRecord | null; // 無ければセッション部の不在期間の記録の部分だけ省く
  currentStage: RelationshipStage; // 今の関係の段階（D-033）。呼び出し元が record.stageKey から解決して渡す
  relationshipHistoryText: string; // formatRelationshipHistoryForPrompt の文章（D-033）
  now: Date;
  isPlayerMessage: boolean; // false（ログイン時の挨拶）かつ孤独感がしきい値以上のとき、再会の【備考】を出す
}

// -------------------------------------------------------
// 公開関数
// -------------------------------------------------------

/** dialogueGenerator のシステムプロンプトを、層ごとの文字列の配列 [固定部, セッション部, 可変部] で返す */
export function buildDialogueGeneratorPromptLayers(input: DialogueGeneratorPromptInput): string[] {
  const {
    world,
    character,
    affectState,
    memories,
    historyLogs,
    latestAbsenceRecord,
    currentStage,
    relationshipHistoryText,
    now,
    isPlayerMessage,
  } = input;
  const timeZone = world.timezone;

  const fixed = Mustache.render(FIXED_TEMPLATE, buildPromptContext(world, character), PROMPT_PARTIALS);

  // 段階に口調の例文があればそれを、無ければキャラクター共通の例文を使う（D-033）
  const stageSpeechExamples =
    currentStage.speechExamples.length > 0 ? currentStage.speechExamples : character.speechExamples;
  const sessionContext = {
    stage: currentStage,
    ...buildSpeechExamplesContext(character.name, stageSpeechExamples),
    hasAbsenceRecord: latestAbsenceRecord !== null,
    ...(latestAbsenceRecord ? formatAbsenceRecordForPrompt(latestAbsenceRecord, timeZone) : {}),
  };
  const session = Mustache.render(SESSION_TEMPLATE, sessionContext, PROMPT_PARTIALS);

  // 再会の【備考】: 孤独感がしきい値以上、かつプレイヤーの発言が無い（ログイン時の挨拶）ときだけ出す（D-040）
  const isReunion = !isPlayerMessage && affectState.needs.loneliness >= REUNION_LONELINESS_THRESHOLD;

  const variable = Mustache.render(VARIABLE_TEMPLATE, {
    currentDatetime: formatLocalDateTime(now, timeZone),
    moodText: formatAffectForPrompt(affectState),
    perceptionText: formatPerceptionForPrompt(roundPerception(affectState.perception)),
    relationshipHistoryText,
    memoriesText: formatMemoriesText(memories),
    historyText: formatHistoryText(historyLogs, character.name, timeZone),
    isReunion,
    reunionBehavior: describeReunionBehavior(character.attachmentStyle ?? "secure"),
  });

  return [fixed, session, variable];
}

// -------------------------------------------------------
// 可変部の各セクションの文字列を作るヘルパー（すべて非export）
// -------------------------------------------------------

/** 関係値は now まで進めた結果が小数になっているため、formatPerceptionForPrompt に渡す前に軸ごとに丸める */
function roundPerception(perception: Perception): Perception {
  return {
    trust: Math.round(perception.trust),
    affection: Math.round(perception.affection),
    respect: Math.round(perception.respect),
    fear: Math.round(perception.fear),
    dependence: Math.round(perception.dependence),
    familiarity: Math.round(perception.familiarity),
  };
}

/** 【重要な記憶】: "・要約 → キャラクターの解釈" の形 */
function formatMemoriesText(memories: CharacterMemoryItem[]): string {
  if (memories.length === 0) return "（なし）";
  return memories
    .map((m) => {
      const summary = m.eventSummary ?? "";
      const interp = m.characterInterpretation ? `→ ${m.characterInterpretation}` : "";
      return `・${summary}${interp ? " " + interp : ""}`;
    })
    .join("\n");
}

/** 【最近の会話】: "日時 （話者）「発言」" を1行ずつ */
function formatHistoryText(
  logs: HistoryLogForPrompt[],
  characterName: string,
  timeZone: string
): string {
  if (logs.length === 0) return "（なし）";
  return logs
    .map((log) => {
      const speaker = log.role === "user" ? "プレイヤー" : characterName;
      const dt = formatLocalDateTime(new Date(log.index), timeZone);
      return `${dt} （${speaker}）「${log.content}」`;
    })
    .join("\n");
}
