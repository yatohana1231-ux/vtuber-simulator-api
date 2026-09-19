// -------------------------------------------------------
// LLM による採点
//
// 1回の実行（RunResult）を、評価基準（RubricCriterion[]）に沿って採点用モデルに
// 1〜5で採点させ、JudgeResult を返す。プロンプトは日本語（システム: 採点者の役割・
// 評価基準の全観点・採点のルール・出力形式。ユーザー: シナリオの説明・judgeFocus・
// キャラクター・世界観・機能ごとの入力/出力）。比較対象のモデル名（modelKey/modelId）は
// 採点の偏りを避けるため一切渡さない。
//
// 採点の呼び出しの使用量・所要時間・料金は bedrockRecorder の start()/stop() で
// 個別に取る（実行本体の RunResult.modelCalls とは混ぜない）。
// -------------------------------------------------------

import { invokeModelJson } from "../../../src/lib/bedrock.js";
import { formatAbsenceRecordForPrompt } from "../../../src/lib/absenceRecordText.js";
import { formatLocalDateTime } from "../../../src/lib/timezone.js";
import { formatAffectForPrompt } from "../../../src/lib/affect/affectText.js";
import * as bedrockRecorder from "./bedrockRecorder.js";
import { calculateRunCost } from "./cost.js";
import { getSavedAbsenceRecord } from "./checks/absenceSimulator.js";
import { getParsedModelOutput } from "./checks/emotionUpdater.js";
import { getSavedMemories } from "./checks/memoryRetriever.js";
import type { CheckContext } from "./checks/types.js";
import {
  EMOTION_KEYS,
  type AbsenceRecord,
  type AbsenceSimulatorResult,
  type Appraisal,
  type CharacterAffectState,
  type CharacterDefinition,
  type InteractionLabels,
  type PendingSession,
  type Perception,
  type RelationshipStage,
  type World,
} from "../../../src/types.js";
import type { JudgeResult, ModelPrice, RubricCriterion, RunResult, Scenario, ScenarioRequest } from "./types.js";

// -------------------------------------------------------
// システムプロンプト（機能ごとの評価基準から組み立てる。呼び出しの間は変わらない）
// -------------------------------------------------------

function formatCriterion(c: RubricCriterion): string {
  return [`### ${c.id}: ${c.name}`, c.description, `- 5: ${c.anchors[5]}`, `- 3: ${c.anchors[3]}`, `- 1: ${c.anchors[1]}`].join(
    "\n"
  );
}

export function buildJudgeSystemPrompt(criteria: RubricCriterion[]): string {
  const criteriaText = criteria.map(formatCriterion).join("\n\n");

  return [
    "あなたは、ゲームに登場する AI キャラクターの出力を採点する採点者です。",
    "以下の評価基準の観点ごとに、出力を厳しく公平に採点してください。",
    "",
    "## 評価基準",
    "",
    criteriaText,
    "",
    "## 採点のルール",
    "- 各観点について、1・3・5 の目安を参考に、1〜5の整数で採点してください（小数・範囲外の値は不可）。",
    "- 理由は1〜2文の簡潔な日本語で書いてください。",
    "- シナリオの前提（説明・重視する観点）と、示された入力に照らして判断してください。",
    "- 出力に書かれていない長所を推測で足さないでください。",
    "- 評価基準に無い観点で減点しないでください。",
    "- そのシナリオの入力と出力に、その観点で評価する材料が無い場合（例: 続いている話題が無く、新しい話題も作られていないときの話題の扱い。記憶を1件も保存しておらず、保存しないのが妥当なときの要約の正確さ・重要度・タグ）は、score を null にし、reason を「対象外: <理由>」としてください。材料があるのに点数を付けにくいだけの場合は対象外にしないでください。",
    "",
    "## 出力形式",
    "次の JSON 以外は出力しないでください（説明文やコードフェンス以外の文章を含めないでください）。",
    "```json",
    "{",
    '  "scores": {',
    '    "<観点のid>": { "score": <1〜5の整数>, "reason": "<採点の理由>" },',
    '    "<対象外の観点のid>": { "score": null, "reason": "対象外: <理由>" }',
    "  },",
    '  "comment": "<全体の短い所見>"',
    "}",
    "```",
  ].join("\n");
}

// -------------------------------------------------------
// ユーザーメッセージ（シナリオ・キャラクター・世界観・機能ごとの入力/出力）
// -------------------------------------------------------

function formatPerception(p: Perception): string {
  return `trust=${p.trust} affection=${p.affection} respect=${p.respect} fear=${p.fear} dependence=${p.dependence} familiarity=${p.familiarity}`;
}

function formatCharacterSection(character: CharacterDefinition): string {
  const examples =
    character.speechExamples.length > 0
      ? character.speechExamples.map((e) => `- プレイヤー「${e.player}」→ ${character.name}「${e.reply}」`).join("\n")
      : "（なし）";
  return [
    `名前: ${character.name}`,
    `性格: ${character.personality}`,
    `話し方: ${character.speechStyle}`,
    `関係性: ${character.relationship}`,
    `設定: ${character.background}`,
    `口調の例文:\n${examples}`,
  ].join("\n");
}

/**
 * 今の関係の段階（D-033）を、シナリオの state.relationship.stageKey から解決する。
 * シナリオに関係の記録が無ければ、dialogueGenerator 本体と同じく先頭の段階（最初の段階）を使う。
 * stageKey が character.relationshipStages に見つからない場合も先頭の段階にする。
 */
function resolveCurrentRelationshipStage(scenario: Scenario, character: CharacterDefinition): RelationshipStage {
  const stageKey = scenario.state?.relationship?.stageKey;
  const stages = character.relationshipStages;
  const found = stageKey ? stages.find((s) => s.key === stageKey) : undefined;
  return found ?? stages[0];
}

/**
 * 今の関係の段階の説明・話し方・口調の例文（段階に無ければキャラクター共通の例文）を、
 * 採点者が「今の段階に合った口調・距離感か」を判断できる形にする（D-033）。
 */
function formatRelationshipStageSection(character: CharacterDefinition, stage: RelationshipStage): string {
  const examples = stage.speechExamples.length > 0 ? stage.speechExamples : character.speechExamples;
  const examplesText =
    examples.length > 0
      ? examples.map((e) => `- プレイヤー「${e.player}」→ ${character.name}「${e.reply}」`).join("\n")
      : "（なし）";
  return [
    `段階: ${stage.label}`,
    `関係と距離感: ${stage.description}`,
    `この段階の話し方: ${stage.speechStyle}`,
    `この段階の口調の例文:\n${examplesText}`,
  ].join("\n");
}

function formatWorldSection(world: World): string {
  return [
    `説明: ${world.description}`,
    `ルール: ${world.rules.length > 0 ? world.rules.join(" / ") : "（なし）"}`,
    `存在しない要素: ${world.forbiddenElements.length > 0 ? world.forbiddenElements.join(" / ") : "（なし）"}`,
  ].join("\n");
}

function formatMemoriesText(memories: Array<{ eventSummary?: string; characterInterpretation?: string }>): string {
  if (memories.length === 0) return "（なし）";
  return memories
    .map((m) => `・${m.eventSummary ?? ""}${m.characterInterpretation ? `（${m.characterInterpretation}）` : ""}`)
    .join("\n");
}

function formatLogsText(
  logs: Array<{ role: "user" | "assistant"; content: string }>,
  characterName: string
): string {
  if (logs.length === 0) return "（なし）";
  return logs.map((l) => `${l.role === "user" ? "プレイヤー" : characterName}: ${l.content}`).join("\n");
}

function formatAbsenceRecordSection(record: AbsenceRecord, timeZone: string): string {
  const t = formatAbsenceRecordForPrompt(record, timeZone);
  return `期間: ${t.periodText}\n出来事:\n${t.eventsText}\n行動:\n${t.actionsText}\n続いている話題:\n${t.openThreadsText}`;
}

interface UserMessageSection {
  input: string;
  output: string;
}

function buildAbsenceSimulatorSection(scenario: Scenario, result: RunResult, context: CheckContext): UserMessageSection {
  const req = scenario.request as Extract<ScenarioRequest, { lastLoginAt: string }>;
  const tz = context.world.timezone;
  const periodText = `${formatLocalDateTime(new Date(req.lastLoginAt), tz)} 〜 ${formatLocalDateTime(new Date(req.now), tz)}`;

  const priorRecords = scenario.state?.absenceRecords ?? [];
  const priorRecordsText =
    priorRecords.length === 0
      ? "（なし）"
      : priorRecords
          .map((r, i) => `[記録${i + 1}]\n${formatAbsenceRecordSection(r as AbsenceRecord, tz)}`)
          .join("\n\n");

  const input = [`不在期間: ${periodText}`, `直近の不在期間の記録（古い順。最後が最新）:\n${priorRecordsText}`].join("\n\n");

  const output = result.output as AbsenceSimulatorResult | undefined;
  const eventsText =
    !output || output.events.length === 0
      ? "（なし）"
      : output.events.map((e, i) => `${i + 1}. [${e.kind}] ${e.summary}\n   ${e.detail}`).join("\n");
  const actionsText =
    !output || output.actions.length === 0
      ? "（なし）"
      : output.actions
          .map((a) => {
            const start = formatLocalDateTime(new Date(a.startDatetime), tz);
            const end = formatLocalDateTime(new Date(a.endDatetime), tz);
            return `・${start}〜${end} ${a.action}${a.memo ? `（${a.memo}）` : ""}`;
          })
          .join("\n");
  const savedRecord = getSavedAbsenceRecord(result);
  const threadsText =
    !savedRecord || savedRecord.threads.length === 0
      ? "（なし）"
      : savedRecord.threads.map((t) => `・[${t.status}] ${t.topic}`).join("\n");

  return {
    input,
    output: [`出来事:\n${eventsText}`, `行動:\n${actionsText}`, `話題:\n${threadsText}`].join("\n\n"),
  };
}

function buildDialogueGeneratorSection(scenario: Scenario, result: RunResult, context: CheckContext): UserMessageSection {
  const req = scenario.request as Extract<ScenarioRequest, { message: string }>;
  const tz = context.world.timezone;
  // mood/perceptionはリクエストでは受け取らない（D-032）。今の状態は result.preAffectState
  // （D-040 フェーズ16。シナリオの state.affect を省略した項目も含めて解決済みの値）を使う。
  const affectState = result.preAffectState;
  const memories = scenario.state?.memories ?? [];
  const logs = scenario.state?.conversationLogs ?? [];
  const absenceRecords = scenario.state?.absenceRecords ?? [];
  const latest = absenceRecords[absenceRecords.length - 1];
  const currentStage = resolveCurrentRelationshipStage(scenario, context.character);

  const input = [
    `プレイヤーの発言: ${req.message === "" ? "（不在。プレイヤーが来た）" : req.message}`,
    `長期不在フラグ（longTimeFlag）: ${req.longTimeFlag === 1 ? "1（長期不在明け）" : "0"}`,
    `今の関係の段階:\n${formatRelationshipStageSection(context.character, currentStage)}`,
    `感情・気分・欲求:\n${formatAffectForPrompt(affectState)}`,
    `関係値: ${formatPerception(affectState.perception)}`,
    `重要記憶:\n${formatMemoriesText(memories)}`,
    `直近の会話:\n${formatLogsText(logs, context.character.name)}`,
    `最新の不在期間の記録:\n${latest ? formatAbsenceRecordSection(latest as AbsenceRecord, tz) : "（なし）"}`,
  ].join("\n\n");

  const reply = typeof result.output === "string" ? result.output : undefined;
  const output = `セリフ: ${reply ?? "（出力なし）"}`;

  return { input, output };
}

/** appraisals（検証後）を1件ずつ、番号・要約・評価の各項目にして並べる */
function formatAppraisalsText(appraisals: Appraisal[]): string {
  if (appraisals.length === 0) return "（評価なし）";
  return appraisals
    .map((a, i) => {
      const goal = a.relatedGoalKey ?? "（なし）";
      return [
        `${i + 1}. ${a.summary || "（要約なし）"}`,
        `   desirabilityForSelf=${a.desirabilityForSelf} desirabilityForPlayer=${a.desirabilityForPlayer} prospect=${a.prospect} cause=${a.cause} praiseworthiness=${a.praiseworthiness} relatedGoalKey=${goal}`,
      ].join("\n");
    })
    .join("\n");
}

/** interaction（process=2 だけ検証後の値がある）を項目ごとに並べる */
function formatInteractionText(interaction: InteractionLabels | null): string {
  if (!interaction) return "（process=1 のため無し）";
  return [
    `playerSelfDisclosure=${interaction.playerSelfDisclosure}`,
    `responseToCharacterDisclosure=${interaction.responseToCharacterDisclosure}`,
    `helpedCharacter=${interaction.helpedCharacter}`,
    `rememberedPastTopic=${interaction.rememberedPastTopic}`,
  ].join(" ");
}

/** サーバーが加えた情動の変化（実行前後の差。絶対値 0.5 未満は変化なしとみなして省く） */
function formatEmotionDiffText(before: CharacterAffectState["emotions"], after: CharacterAffectState["emotions"]): string {
  const diffs = EMOTION_KEYS.map((key) => ({ key, delta: after[key] - before[key] })).filter(
    (d) => Math.abs(d.delta) >= 0.5
  );
  if (diffs.length === 0) return "（変化なし）";
  return diffs.map((d) => `${d.key}:${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(1)}`).join(" ");
}

/** 今回の発言の関係値への寄与（pendingSession.last）。関係値そのものはこの時点では動いていない */
function formatPendingContributionText(pending: PendingSession | null): string {
  if (!pending) return "（無し）";
  const entries = Object.entries(pending.last).filter(([, v]) => v !== undefined && v !== 0);
  if (entries.length === 0) return "（変化なし）";
  return entries.map(([key, value]) => `${key}:${(value as number) >= 0 ? "+" : ""}${(value as number).toFixed(2)}`).join(" ");
}

/**
 * emotionUpdater の採点の入力（D-040 フェーズ16b）。LLM が出した評価（appraisals・interaction。
 * サーバーが検証したあとの値）、それでサーバーが加えた情動（実行前後の差）、気分・欲求の前後
 * （formatAffectForPrompt の文章）、pendingSession.last（今回の発言の関係値への寄与。関係値
 * そのものはセッションが終わるまで動かないため、process=2 でも perception は載せない）を渡す。
 * 入力テキストには、process=2 のときの直近の会話も含める。
 */
function buildEmotionUpdaterSection(scenario: Scenario, result: RunResult, context: CheckContext): UserMessageSection {
  const req = scenario.request as { process: 1 | 2; playerMessage?: string };
  const tz = context.world.timezone;
  const before = result.preAffectState;

  let inputText: string;
  if (req.process === 1) {
    const absenceRecords = scenario.state?.absenceRecords ?? [];
    const latest = absenceRecords[absenceRecords.length - 1];
    inputText = latest
      ? `不在中の出来事・行動:\n${formatAbsenceRecordSection(latest as AbsenceRecord, tz)}`
      : "（不在期間の記録なし）";
  } else {
    const logs = scenario.state?.conversationLogs ?? [];
    const logsText = logs.length > 0 ? `\n\n直近の会話:\n${formatLogsText(logs, context.character.name)}` : "";
    inputText = `プレイヤーの発言: ${req.playerMessage ?? ""}${logsText}`;
  }

  const input = [inputText, `更新前の気分・欲求:\n${formatAffectForPrompt(before)}`].join("\n\n");

  const after = result.postAffectState;
  if (!after) {
    return { input, output: "（出力なし）" };
  }

  const parsed = getParsedModelOutput(result, context);
  const appraisalsText = parsed ? formatAppraisalsText(parsed.appraisals) : "（モデルの応答から評価を読み取れなかった）";

  const outputLines = [`LLM が出した評価（appraisals）:\n${appraisalsText}`];
  if (req.process === 2) {
    outputLines.push(`やり取りの分類（interaction）:\n${formatInteractionText(parsed?.interaction ?? null)}`);
  }
  outputLines.push(`サーバーが加えた情動の変化: ${formatEmotionDiffText(before.emotions, after.emotions)}`);
  outputLines.push(`更新後の気分・欲求:\n${formatAffectForPrompt(after)}`);
  if (req.process === 2) {
    outputLines.push(`今回の発言の関係値への寄与（pendingSession.last）: ${formatPendingContributionText(after.pendingSession)}`);
  }

  return { input, output: outputLines.join("\n\n") };
}

function buildMemoryRetrieverSection(scenario: Scenario, result: RunResult, context: CheckContext): UserMessageSection {
  const req = scenario.request as { process: 1 | 2 };
  const tz = context.world.timezone;

  let inputText: string;
  if (req.process === 1) {
    const absenceRecords = scenario.state?.absenceRecords ?? [];
    const latest = absenceRecords[absenceRecords.length - 1];
    inputText = latest
      ? `不在中の出来事・行動:\n${formatAbsenceRecordSection(latest as AbsenceRecord, tz)}`
      : "（不在期間の記録なし）";
  } else {
    const logs = scenario.state?.conversationLogs ?? [];
    inputText = logs.length === 0 ? "（会話ログなし）" : formatLogsText(logs, context.character.name);
  }

  const existingMemories = scenario.state?.memories ?? [];
  const input = [`判定対象:\n${inputText}`, `既存の重要記憶:\n${formatMemoriesText(existingMemories)}`].join("\n\n");

  const saved = getSavedMemories(result);
  const savedText =
    saved.length === 0
      ? "保存無し"
      : saved
          .map(
            (m) =>
              `・要約: ${m.eventSummary ?? ""}\n  解釈: ${m.characterInterpretation ?? ""}\n  重要度: ${
                m.importance ?? ""
              }\n  タグ: ${(m.tags ?? []).join(", ") || "（なし）"}\n  種類: ${m.memoryType ?? ""}`
          )
          .join("\n");

  return { input, output: `保存された記憶:\n${savedText}` };
}

export function buildJudgeUserMessage(scenario: Scenario, result: RunResult, context: CheckContext): string {
  const focusText =
    scenario.judgeFocus && scenario.judgeFocus.length > 0 ? scenario.judgeFocus.map((f) => `・${f}`).join("\n") : "（指定なし）";

  let section: UserMessageSection;
  switch (scenario.function) {
    case "absenceSimulator":
      section = buildAbsenceSimulatorSection(scenario, result, context);
      break;
    case "dialogueGenerator":
      section = buildDialogueGeneratorSection(scenario, result, context);
      break;
    case "emotionUpdater":
      section = buildEmotionUpdaterSection(scenario, result, context);
      break;
    case "memoryRetriever":
      section = buildMemoryRetrieverSection(scenario, result, context);
      break;
    default: {
      const exhaustiveCheck: never = scenario.function;
      throw new Error(`judge: unknown function: ${String(exhaustiveCheck)}`);
    }
  }

  return [
    "## シナリオ",
    `説明: ${scenario.description}`,
    `重視する観点:\n${focusText}`,
    "",
    "## キャラクター",
    formatCharacterSection(context.character),
    "",
    "## 世界観",
    formatWorldSection(context.world),
    "",
    "## 入力",
    section.input,
    "",
    "## 出力",
    section.output,
  ].join("\n");
}

// -------------------------------------------------------
// 採点の実行
// -------------------------------------------------------

/** 採点用モデルの応答（JSON）の形。invokeModelJson のパース失敗時は fallback をそのまま返す */
interface JudgeModelOutput {
  scores?: Record<string, { score?: unknown; reason?: unknown } | undefined>;
  comment?: unknown;
}

export interface JudgeRunArgs {
  scenario: Scenario;
  result: RunResult;
  criteria: RubricCriterion[];
  context: CheckContext;
  judgeModelId: string;
  temperature: number;
  maxTokens: number;
  pricing: Record<string, ModelPrice>;
}

function formatError(e: unknown): string {
  const err = e as { name?: string; message?: string } | undefined;
  return `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`;
}

/**
 * この実行を採点すべきか。呼び出し側（cli.ts）が judgeRun を呼ぶ前に使う。
 * result.error がある実行（run* が例外を投げた）、result.modelCalls が空の実行
 * （Bedrock を呼ばないのが正しいシナリオ。例: process=1 で記録が無いときの emotionUpdater/memoryRetriever）は
 * 採点の対象外（judge を付けない）。
 */
export function shouldJudge(result: RunResult): boolean {
  return result.error === undefined && result.modelCalls.length > 0;
}

/**
 * 1回の実行（RunResult）を評価基準に沿って採点する。
 * 採点しない条件（result.error がある、result.modelCalls が空）の判定は呼び出し側（cli.ts）が行う。
 */
export async function judgeRun(args: JudgeRunArgs): Promise<JudgeResult> {
  const { scenario, result, criteria, context, judgeModelId, temperature, maxTokens, pricing } = args;

  const systemPrompt = buildJudgeSystemPrompt(criteria);
  const userMessage = buildJudgeUserMessage(scenario, result, context);

  // JSON.parse 失敗時に invokeModelJson がこの fallback をそのまま返すため、
  // 参照が一致するかどうかで「パースできたか」を判定する。
  const fallback: JudgeModelOutput = { scores: {} };

  const scores: Record<string, number | null> = {};
  const reasons: Record<string, string> = {};
  const notApplicable: string[] = [];
  for (const c of criteria) {
    scores[c.id] = null;
    reasons[c.id] = "";
  }

  let comment: string | undefined;
  let error: string | undefined;

  bedrockRecorder.start();
  const startedAt = Date.now();

  try {
    const raw = await invokeModelJson<JudgeModelOutput>([systemPrompt], userMessage, fallback, maxTokens, {
      modelId: judgeModelId,
      temperature,
    });

    if (raw === fallback) {
      error = "採点モデルの応答から JSON を読み取れませんでした";
    } else {
      for (const c of criteria) {
        const entry = raw.scores?.[c.id];
        const scoreRaw = entry?.score;
        const reasonRaw = typeof entry?.reason === "string" ? entry.reason : "";
        const isNAScore = scoreRaw === null || (typeof scoreRaw === "string" && scoreRaw.toLowerCase() === "n/a");

        if (isNAScore && reasonRaw.startsWith("対象外")) {
          scores[c.id] = null;
          notApplicable.push(c.id);
        } else {
          scores[c.id] =
            typeof scoreRaw === "number" && Number.isInteger(scoreRaw) && scoreRaw >= 1 && scoreRaw <= 5 ? scoreRaw : null;
        }
        reasons[c.id] = reasonRaw;
      }
      comment = typeof raw.comment === "string" ? raw.comment : undefined;
    }
  } catch (e) {
    error = formatError(e);
  }

  const latencyMs = Date.now() - startedAt;
  const calls = bedrockRecorder.stop();
  const costUsd = calculateRunCost(calls, pricing);

  return { judgeModelId, scores, reasons, notApplicable, comment, costUsd, latencyMs, error };
}
