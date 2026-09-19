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
  speechStyle: string; // 段階によらない話し方（段階ごとの話し方は relationshipStages に書く。D-033）
  relationship: string; // 段階によらない関係の前提（例: 「配信者とリスナー」）
  background: string;
  speechExamples: SpeechExample[];
  initialPerception: Perception; // 状態レコードが無いときの perception の初期値（最初の段階に合う値。D-033）
  relationshipStages: RelationshipStage[]; // 関係の段階（先頭が最初の段階。1つ以上。D-033）
}

/** 関係の段階に上がるための条件（すべて満たしたら上がる。D-033） */
export interface RelationshipStagePromotion {
  minConversationDays: number; // プレイヤーが発言した日の数（世界観のタイムゾーンの日付）
  minConversationCount: number; // プレイヤーの発言の回数
  minPerception: Partial<Perception>; // 関係値の下限（書いた軸だけを見る）
}

/** 関係の段階の定義（content/characters/*.json の relationshipStages の1要素。D-033） */
export interface RelationshipStage {
  key: string;
  label: string; // 段階の名前（例: 「はじめまして」）。節目の記録に使う
  description: string; // この段階の関係と距離感
  speechStyle: string; // この段階の話し方
  speechExamples: SpeechExample[]; // この段階の口調の例文（空なら character.speechExamples を使う）
  promoteWhen: RelationshipStagePromotion | null; // この段階に上がる条件。先頭の段階は null
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

/**
 * 関係の記録（キャラクター記憶テーブルの index = "relationship" のレコードの中身。D-033）。
 * 日時はすべて ISO8601（/dialogue-generator のリクエストの now を基準にする）。
 */
export interface RelationshipRecord {
  firstMetAt: string; // 最初に /dialogue-generator が呼ばれた日時（ログイン時の挨拶を含む）
  lastConversationAt: string | null; // 最後にプレイヤーが発言した日時（まだ無ければ null）
  lastConversationDate: string | null; // 最後に発言した日（世界観のタイムゾーンの YYYY-MM-DD）
  conversationCount: number; // プレイヤーの発言の回数（空の message は数えない）
  conversationDays: number; // プレイヤーが発言した日の数
  stageKey: string; // 今の段階
  highestStageKey: string; // これまでに到達した一番上の段階（下がったあとに戻る先）
  recoveryRemaining: number; // 下がったあと、戻るまでに残っている発言の回数（下がっていなければ 0）
  lastDemotedAt: string | null; // 最後に段階が下がった日時（1回の不在で下がるのは1段階だけにするため）
  updatedAt: string;
}

/** 段階の変化（節目）。重要記憶とログに残し、プレイヤーには伝えない（D-033） */
export interface RelationshipMilestone {
  kind: "promoted" | "demoted" | "recovered";
  fromStageKey: string;
  toStageKey: string;
  at: string; // ISO8601
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
// テスターのキャラクターの所有（tester-character-ownership-roadmap フェーズ3）
//
// キャラクター記憶テーブルとは別の新しいテーブル（環境変数
// TESTER_CHARACTERS_TABLE）に、テスターごとに持つキャラクターの一覧を保存する。
// DynamoDB 上のキー名（tester_id・character_id）とは異なり、こちらはコード内で
// 扱いやすいキャメルケースの名前にしている（dynamo.ts で相互に変換する）。
// -------------------------------------------------------

export interface TesterCharacter {
  testerId: string;
  characterId: string; // サーバーが発番する UUID
  packageId: string;
  label: string;
  createdAt: string; // ISO8601
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

/** process=1（ログイン時）。入力は最新の不在期間の記録で、DynamoDB から読む（D-022） */
export interface EmotionUpdaterRequestProcess1 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 1;
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

/** process=1（ログイン時）。入力は最新の不在期間の記録で、DynamoDB から読む（D-022） */
export interface MemoryRetrieverRequestProcess1 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  process: 1;
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
  // mood/perception はリクエストで渡さず、常に DynamoDB から取得する（D-032）
  longTimeFlag?: 0 | 1; // 不在期間の出来事・行動は最新の記録を DynamoDB から読む（D-022）
}

export interface DialogueGeneratorResponse {
  reply: string;
}

// -------------------------------------------------------
// debugCharacterState（デバッグ専用。.notes/debug-character-state-roadmap.md）
// -------------------------------------------------------

/**
 * mood/perception を直接指定して状態レコードを書き換えるデバッグ専用の入力。
 * `world` は使わない（`character.initialPerception` だけを使う）。
 * `mood`/`perception` は片方だけの指定、両方省略（読み取りのみ）を許す。
 */
export interface DebugCharacterStateRequest {
  characterId: string;
  character: CharacterDefinition;
  mood?: Mood;
  perception?: Perception;
}

/** レスポンスは /emotion-updater と同じ形（保存後の値） */
export type DebugCharacterStateResponse = EmotionUpdaterResponse;
