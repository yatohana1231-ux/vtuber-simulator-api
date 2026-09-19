// -------------------------------------------------------
// AI 応答テストの共通の型
//
// シナリオ（入力と期待すること）、1回の実行の結果、集計の形を定める。
// 仕組みの各部品（実行・判定・集計・レポート）はこの型だけを介してつながる。
// 考え方は test/test_ai_response/README.md、計画は .notes/model-selection-roadmap.md。
// -------------------------------------------------------

import type {
  AbsenceRecord,
  CharacterAffectState,
  CharacterMemoryItem,
  ConversationLogItem,
  Emotions,
  MoodPad,
  Needs,
  PendingSession,
  Perception,
  RelationshipRecord,
} from "../../../src/types.js";

/** LLM を呼ぶ4つの機能 */
export type TargetFunction =
  | "absenceSimulator"
  | "dialogueGenerator"
  | "emotionUpdater"
  | "memoryRetriever";

export const TARGET_FUNCTIONS: readonly TargetFunction[] = [
  "absenceSimulator",
  "dialogueGenerator",
  "emotionUpdater",
  "memoryRetriever",
];

/**
 * シナリオ内の日時。ISO8601 の絶対時刻か、実行開始時刻からの相対指定（"now"、"now-30h"、"now-2d"、"now+15m"）。
 * 相対指定は、仕組みが実行開始時に ISO8601 に解決する（記憶の新しさや話題の14日の自動クローズなど、
 * サーバーの現在時刻に左右される処理のため）。
 */
export type ScenarioDatetime = string;

/**
 * シナリオで DynamoDB に入れておく感情・関係値の状態（D-040 フェーズ16a）。
 * 省略した項目は、キャラクターの初期状態（createInitialAffectState + resolveAffectProfile）で埋める。
 * affect 自体を省略したシナリオは、状態レコードを一切投入しない（本番と同じく初期状態から始まる）。
 */
export interface ScenarioAffectState {
  /** 書いた情動だけを上書きする。書いていない情動は 0（平常） */
  emotions?: Partial<Emotions>;
  /** 省略時はキャラクターの気分の平常値（bigFive/affectTuning から決まる） */
  mood?: MoodPad;
  /** 書いた欲求だけを上書きする（fatigue は実行時に生活様式から計算し直されるので、実質 loneliness 用） */
  needs?: Partial<Needs>;
  /** 省略時は character.initialPerception */
  perception?: Perception;
  /** 進行中のセッションの途中経過。省略時は無し（null）。明示的に null を書いても同じ */
  pendingSession?: PendingSession | null;
  /** 時間による変化の基準の日時。省略時は実行開始時刻（＝時間の変化なし）。相対指定も可 */
  affectUpdatedAt?: ScenarioDatetime;
}

/** シナリオで DynamoDB に入れておく状態。省略した項目は空（感情・関係値は affect 参照） */
export interface ScenarioState {
  /** 感情・関係値の状態（D-040）。省略時は状態レコードなし（本番の初期状態と同じ） */
  affect?: ScenarioAffectState;
  /** 重要記憶。memory_id は仕組みが characterId で埋める。updatedAt は相対指定も可 */
  memories?: Array<Omit<CharacterMemoryItem, "memory_id"> & { updatedAt?: ScenarioDatetime }>;
  /** 会話ログ（古い順）。conversation_id は仕組みが埋める。index（時刻）は相対指定も可 */
  conversationLogs?: Array<Omit<ConversationLogItem, "conversation_id"> & { index: ScenarioDatetime }>;
  /**
   * 不在期間の記録（古い順）。最後の1件が「最新の記録」（キャラクター記憶テーブルの absence-latest）になり、
   * すべてがイベントテーブルの履歴に入る。event_id・characterId は仕組みが埋める。日時は相対指定も可
   */
  absenceRecords?: Array<Omit<AbsenceRecord, "event_id" | "characterId">>;
  /**
   * 関係の記録（キャラクター記憶テーブルの index = "relationship"。D-033）。省略時は記録なし
   * （dialogueGenerator は最初の段階から記録を始める）。保存の形は dynamo.ts の
   * saveRelationshipRecord と同じ（memory_id・index は仕組みが埋める）。日時
   * （firstMetAt・lastConversationAt・lastDemotedAt・updatedAt）は相対指定も可。
   * lastConversationDate（暦日 YYYY-MM-DD）は、プレイヤーの発言がある呼び出しでその日の
   * 会話かどうかの判定にだけ使われるため、シナリオでは厳密な値でなくてよい。
   */
  relationship?: RelationshipRecord;
}

/**
 * 機能ごとのリクエストの値（world / character / lifestyle はパッケージから仕組みが埋める）。
 * emotionUpdater の now は D-040 で必須になったため受け取れるようにしてある
 * （省略時は実行開始時刻を使う。memoryRetriever は process=1/2 とも now を受け取らない）。
 */
export type ScenarioRequest =
  | { lastLoginAt: ScenarioDatetime; now: ScenarioDatetime } // absenceSimulator
  | { message: string; now?: ScenarioDatetime; longTimeFlag?: 0 | 1 } // dialogueGenerator（mood/perceptionはD-032で廃止。初期値はstate.affectで与える）
  | { process: 1; now?: ScenarioDatetime } // emotionUpdater(process=1) / memoryRetriever(process=1)
  | { process: 2; playerMessage: string; now?: ScenarioDatetime } // emotionUpdater（process=2）
  | { process: 2 }; // memoryRetriever（process=2）

/** ルールによる判定の指定。type ごとの params は checks の実装が検証する */
export interface CheckSpec {
  type: string;
  params?: Record<string, unknown>;
}

export interface Scenario {
  /** 一意の ID（ファイル名と同じにする） */
  id: string;
  function: TargetFunction;
  /** 何を確かめるシナリオか（人が読む説明） */
  description: string;
  /** 省略時は既定パッケージ（yui-modern-tokyo） */
  packageId?: string;
  state?: ScenarioState;
  request: ScenarioRequest;
  /** ルールによる判定 */
  checks?: CheckSpec[];
  /** LLM による採点で重視する観点（フェーズ5で使う。人が読む文） */
  judgeFocus?: string[];
}

/** 1回の Bedrock 呼び出しの記録 */
export interface ModelCallRecord {
  modelId: string;
  /** システムプロンプトの層（cachePoint を除いた text） */
  systemPrompt: string[];
  userMessage: string;
  /** モデルの応答テキスト（例外のときは空） */
  responseText: string;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  /** 例外が起きたときのエラー名とメッセージ */
  error?: string;
}

/** 偽の DynamoDB に対して行われた書き込み（Put / Update / TransactWrite の各 Item） */
export interface DynamoWriteRecord {
  table: "conversationLogs" | "characterMemory" | "events";
  operation: "put" | "update";
  item: Record<string, unknown>;
}

export interface CheckResult {
  type: string;
  passed: boolean;
  /** 不合格の理由や、判定に使った値（人が読む） */
  detail?: string;
}

/** 1回の実行（シナリオ × モデル × 繰り返しの1回）の結果 */
export interface RunResult {
  scenarioId: string;
  function: TargetFunction;
  /** models.json のキー（表示名の短縮形） */
  modelKey: string;
  modelId: string;
  /** 0 始まりの繰り返し番号 */
  repeatIndex: number;
  /** run* の戻り値（例外のときは undefined） */
  output?: unknown;
  /** run* が例外を投げたとき */
  error?: string;
  modelCalls: ModelCallRecord[];
  writes: DynamoWriteRecord[];
  checks: CheckResult[];
  /**
   * 実行前の感情・関係値の状態（D-040 フェーズ16。時間を進める前の、投入した状態。
   * シナリオが state.affect を省略していても、キャラクターの初期状態で埋めた値が入る）。
   * emotionUpdater の判定・採点（差分の向き・大きさ）や、judge.ts の入力の組み立てに使う。
   */
  preAffectState: CharacterAffectState;
  /**
   * 実行後の状態レコード（偽の DynamoDB への最後の書き込み。pendingSession を含む）。
   * 状態レコードへの書き込みが無かった実行（absenceSimulator・memoryRetriever・
   * dialogueGenerator は書かない。D-040）では undefined。
   */
  postAffectState?: CharacterAffectState;
  /** LLM による採点（採点しなかった実行〔例外・Bedrock を呼ばないシナリオ・--no-judge〕では無い） */
  judge?: JudgeResult;
  metrics: {
    /** run* の開始から終了まで */
    totalLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
    /** pricing.json から計算した料金（USD）。料金表に無いモデルは null */
    costUsd: number | null;
  };
}

/** 機能 × モデルごとの集計 */
export interface SummaryRow {
  function: TargetFunction;
  modelKey: string;
  modelId: string;
  runs: number;
  errors: number;
  /** ルールによる判定の合格数 / 判定数 */
  checksPassed: number;
  checksTotal: number;
  avgCostUsd: number | null;
  avgLatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** キャッシュから読んだ入力トークンの割合（cacheRead / (input + cacheRead + cacheWrite)） */
  cacheReadRatio: number;
  /** 採点した実行の数 */
  judgedRuns: number;
  /** 観点の id → 採点の平均（採点できた実行だけで平均。1件も無ければ null） */
  avgJudgeScores: Record<string, number | null>;
  /** 全観点の平均（avgJudgeScores の null を除いた平均。無ければ null） */
  avgJudgeScoreOverall: number | null;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  options: {
    functions: TargetFunction[];
    models: string[];
    repeat: number;
    maxCostUsd: number;
    /** 採点に使ったモデル（採点しなかったときは null） */
    judgeModelId: string | null;
  };
  /** 実行と採点を合わせた料金 */
  totalCostUsd: number;
  /** そのうち採点の料金 */
  judgeCostUsd: number;
  rows: SummaryRow[];
}

/** 評価基準（rubrics/<機能名>.md）の観点1つ */
export interface RubricCriterion {
  /** 観点の id（`### id: 名前` の id） */
  id: string;
  name: string;
  description: string;
  /** 5・3・1 の目安 */
  anchors: { 5: string; 3: string; 1: string };
}

/** LLM による採点の結果（1回の実行ごと） */
export interface JudgeResult {
  /** 採点に使ったモデル（推論プロファイルの ID） */
  judgeModelId: string;
  /** 観点の id → 1〜5 の整数。採点できなかった観点と、対象外（notApplicable）の観点は null */
  scores: Record<string, number | null>;
  /**
   * そのシナリオでは当てはまらない（評価する材料が無い）と採点者が判断した観点の id。
   * 例: 続いている話題が無いシナリオの「話題の扱い」、何も保存しないのが正しいシナリオの「要約の正確さ」。
   * scores は null になり、平均には含めない。
   */
  notApplicable: string[];
  /** 観点の id → 採点の理由 */
  reasons: Record<string, string>;
  /** 全体の短い所見 */
  comment?: string;
  /** 採点にかかった料金（USD）。料金表に無いモデルは null */
  costUsd: number | null;
  latencyMs: number;
  /** 採点の呼び出しや、応答の解釈に失敗したとき */
  error?: string;
}

/** models.json の1件 */
export interface ModelEntry {
  /** 推論プロファイルの ID（Bedrock に渡す modelId） */
  modelId: string;
  displayName: string;
}

/** pricing.json の1件（100万トークンあたりの USD） */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
}
