// -------------------------------------------------------
// キャラクター×世界観パッケージ（api/content/ 配下の JSON）
// -------------------------------------------------------

export interface World {
  key: string;
  name: string;
  description: string;
  rules: string[];
  forbiddenElements: string[];
  timezone: string; // IANA タイムゾーン名（例: "Asia/Tokyo"）。生活様式の時刻をこの世界観の時刻として扱う
}

export interface SpeechExample {
  player: string;
  reply: string;
}

export interface CharacterDefinition {
  key: string;
  name: string;
  personality: string;
  speechStyle: string;
  relationship: string;
  background: string;
  speechExamples: SpeechExample[];
}

export interface CharacterPackage {
  id: string;
  displayName: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
}

// -------------------------------------------------------
// 生活様式（api/content/lifestyles/ 配下の JSON）
//
// 不在期間のシミュレーション（フェーズ2以降）で、行動の枠（時刻と
// 大まかな過ごし方）と出来事の抽選に使う。時刻は世界観（World.timezone）
// のタイムゾーンでの時刻として扱う。
// -------------------------------------------------------

export interface ScheduleSlot {
  start: string; // "HH:MM"（世界観のタイムゾーンでの時刻）
  end: string; // "HH:MM"。end <= start の場合は日をまたぐ枠（翌日の end まで）
  activity: string;
}

export interface EventKind {
  key: string;
  label: string;
  weight: number; // 正の数。抽選時の重み
}

export interface Lifestyle {
  key: string;
  schedules: {
    weekday: ScheduleSlot[];
    holiday: ScheduleSlot[];
  };
  eventKinds: EventKind[];
}

/** 不在期間の行動の枠（骨格）。時刻は ISO8601（UTC、Date#toISOString の形式） */
export interface ActionSlot {
  startDatetime: string;
  endDatetime: string;
  activity: string;
}

/** 不在期間の骨格。サーバーが決め、内容は LLM が肉付けする */
export interface AbsenceSkeleton {
  startDatetime: string; // 不在期間の開始（前回ログイン。ISO8601 UTC）
  endDatetime: string;   // 不在期間の終了（今回ログイン。ISO8601 UTC）
  actionSlots: ActionSlot[];
  eventKinds: EventKind[]; // 抽選された出来事の種類（件数 = 出来事の件数）
}

// -------------------------------------------------------
// 感情 / 関係値
// -------------------------------------------------------

export interface Mood {
  joy: number;
  anxiety: number;
  angry: number;
  fatigue: number;
  confidence: number;
  loneliness: number;
}

export interface Perception {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  dependence: number;
  familiarity: number;
}

export interface CharacterState {
  mood: Mood;
  perception: Perception;
}

// -------------------------------------------------------
// 不在期間中の行動（absenceSimulator が生成する）
// -------------------------------------------------------

export interface Action {
  startDatetime: string;
  endDatetime: string;
  action: string;
  memo: string;
}

// -------------------------------------------------------
// memoryRetriever
// -------------------------------------------------------

export interface RelationshipChanges {
  trust: number;
  affection: number;
  respect: number;
}

export interface MemoryCandidate {
  shouldRemember: boolean;
  eventSummary: string;
  playerAction: string;
  characterInterpretation: string;
  emotion: string;
  importance: number;
  memoryType: string;
  tags: string[];
  relationshipChanges: RelationshipChanges;
  reason: string;
}

export interface MemoryRetrieverResult {
  candidates: MemoryCandidate[];
}

// -------------------------------------------------------
// DynamoDB アイテム型
// -------------------------------------------------------

export interface ConversationLogItem {
  conversation_id: string;
  index: string; // ISO8601 タイムスタンプ（ソートキー）
  role: "user" | "assistant";
  content: string;
  memoryRetrieverJudgedFlag?: number; // 0 or 1
}

export interface CharacterMemoryItem {
  memory_id: string;
  index: string;
  eventSummary?: string;
  characterInterpretation?: string;
  tags?: string[];
  importance?: number;
  memoryType?: string;
  relationshipChanges?: RelationshipChanges;
  emotion?: string;
  reason?: string;
  updatedAt?: string;
}

export interface CharacterStateItem {
  memory_id: string;
  index: "state";
  mood: Mood;
  perception: Perception;
  updatedAt: string;
}

/** キャラクター記憶テーブルに置く、最新の不在期間の記録（D-019） */
export interface LatestAbsenceRecordItem {
  memory_id: string; // characterId
  index: "absence-latest";
  record: AbsenceRecord; // 最新の不在期間の記録（イベントテーブルの履歴と同じ内容）
  updatedAt: string;
}

// -------------------------------------------------------
// 不在期間の記録
//
// eventResolver/actionPlanner を統合する absenceSimulator が
// 既存のイベントテーブルに保存する記録の形。旧 eventResolver が保存していた形式
// （event_id/characterId/startDatetime/endDatetime/elapsed/events: string[]/createdAt の
// フラットな形）の既存データは読み飛ばす想定。詳細は
// .notes/absence-simulation-roadmap.md の「データ構造案」を参照。
// -------------------------------------------------------

export interface AbsenceEvent {
  kind: string; // Lifestyle.eventKinds の key
  summary: string; // 1文の要約
  detail: string; // 聞かれたときに話せる具体的な内容
  threadId?: string; // 続いている話題（AbsenceThread.id）への参照
}

export interface AbsenceThread {
  id: string;
  topic: string;
  status: "open" | "closed";
  openedAt: string;
}

export interface AbsenceRecord {
  event_id: string; // UUID（テーブルのパーティションキー）
  characterId: string; // GSI characterId-index のパーティションキー
  createdAt: string; // GSI のソートキー
  startDatetime: string;
  endDatetime: string;
  events: AbsenceEvent[];
  actions: Action[];
  threads: AbsenceThread[]; // その時点の「続きの話題」の一覧（最新の記録が現在の状態）
}

// -------------------------------------------------------
// エンドポイントリクエスト/レスポンス型
//
// 機能ごとに独立した API エンドポイントとして公開するため、
// これまで NormalizedRequest にまとめていた入力を
// エンドポイントごとにフラットな型として定義する。
// オーケストレーション（どの順で呼ぶか）はフロント側の責務になる。
// -------------------------------------------------------

export interface AbsenceSimulatorRequest {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  lastLoginAt: string; // ISO8601（now より後にならないことはハンドラーで検証済み）
  now: string; // ISO8601
}

/** /absence-simulator のレスポンス。フロントは表示に使ってもよいが、後段に中継する必要はない */
export interface AbsenceSimulatorResult {
  startDatetime: string;
  endDatetime: string;
  events: Array<Pick<AbsenceEvent, "kind" | "summary" | "detail">>;
  actions: Action[];
}

export interface EmotionUpdaterRequestProcess1 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 1;
  events: string[];
  actions: Action[];
}

export interface EmotionUpdaterRequestProcess2 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 2;
  playerMessage: string;
}

export type EmotionUpdaterRequest =
  | EmotionUpdaterRequestProcess1
  | EmotionUpdaterRequestProcess2;

export interface EmotionUpdaterResponse {
  mood: Mood;
  perception: Perception;
}

export interface MemoryRetrieverRequestProcess1 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 1;
  events: string[];
  actions: Action[];
}

export interface MemoryRetrieverRequestProcess2 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 2;
}

export type MemoryRetrieverRequest =
  | MemoryRetrieverRequestProcess1
  | MemoryRetrieverRequestProcess2;

export interface DialogueGeneratorRequest {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  now: string; // ISO8601
  message: string; // 空文字の場合はプレイヤー不在時の代替テキストを内部で使用
  mood?: Mood; // 未指定時は DynamoDB から取得
  perception?: Perception; // 未指定時は DynamoDB から取得
  events?: string[];
  actions?: Action[];
  longTimeFlag?: 0 | 1;
}

export interface DialogueGeneratorResponse {
  reply: string;
}
