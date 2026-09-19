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
  // --- 感情・関係値のモデル（D-040）。どれも省略でき、省略時は lib/affect/personality.ts が既定値にする ---
  bigFive?: BigFive; // 性格（気分の平常値と感じやすさを決める）。省略時はすべて 0（中立）
  goals?: CharacterGoal[]; // 目標・大事にしていること（出来事の評価の基準）。省略時は空
  attachmentStyle?: AttachmentStyle; // 愛着のスタイル（孤独感の増え方と再会のふるまい）。省略時は "secure"
  affectTuning?: AffectTuning; // 既定の設定値（lib/affect/affectConfig.ts）のキャラクターごとの上書き
}

/** 性格の5因子（各 -100〜+100。0 が平均的）。D-040 */
export interface BigFive {
  openness: number; // 開放性
  conscientiousness: number; // 誠実性
  extraversion: number; // 外向性
  agreeableness: number; // 協調性
  neuroticism: number; // 神経症傾向（高いほど情緒が不安定）
}

/** キャラクターの目標・大事にしていること（content/characters/*.json の goals の1要素。D-040） */
export interface CharacterGoal {
  key: string; // 識別子（重複不可）。LLM の評価の relatedGoalKey と突き合わせる
  description: string; // 目標の説明（emotionUpdater のプロンプトの固定部に入る）
  importance: number; // 重要度（1〜100）。情動の強さにかかる
}

export type AttachmentStyle = "secure" | "anxious" | "avoidant";

/**
 * キャラクターごとの設定値の上書き（D-040）。書いた項目だけを上書きする。
 * 倍率（*Scale・*Gain）は 1 が既定と同じ。
 */
export interface AffectTuning {
  moodHomeBase?: MoodPad; // 気分の平常値を bigFive から計算せず、直接指定する
  positiveEmotionGain?: number; // 正の情動の感じやすさの倍率
  negativeEmotionGain?: number; // 負の情動の感じやすさの倍率
  emotionHalfLifeScale?: number; // 情動の半減期の倍率（大きいほど引きずる）
  moodHalfLifeScale?: number; // 気分の半減期の倍率
  lonelinessGrowthScale?: number; // 孤独感の増え方の倍率
  perceptionGainScale?: number; // 関係値の上がりやすさの倍率（関係が深まりやすい・深まりにくい）
  perceptionDampingSigma?: number; // 関係値の釣り鐘の減衰の幅（0 より大きい。小さいほど早くから上がりづらくなる）
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
  maxPerception?: Partial<Perception>; // この段階での関係値の上限（書いた軸だけを見る。書かない軸は 100。D-040）
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
  fatigueChangePerHour?: number; // この枠で1時間あたりに疲労が増える量（負なら回復）。省略時は 0（D-040）
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

export interface Perception {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  dependence: number;
  familiarity: number;
}

// -------------------------------------------------------
// 感情・関係値のモデル（D-040。ALMA を参考にした層の構造）
//
// 情動（短期）・気分（中期）・欲求（身体・欲求の不足）・関係値（項目は従来どおり）。
// 値はどれも内部では小数で持ち、プロンプトと画面には丸めて出す。
// 性格（長期の層）は content/characters/*.json に持つ（CharacterDefinition.bigFive など）。
// 計算はすべて src/lib/affect/ の純粋な関数で行う。
// -------------------------------------------------------

/** 情動の種類（OCC モデルから選んだ12項目） */
export const EMOTION_KEYS = [
  "joy", // 喜び（自分に望ましい出来事が起きた）
  "sadness", // 悲しみ・落ち込み（望ましくない出来事が起きた）
  "hope", // 期待（望ましいことが起きそう）
  "anxiety", // 不安（望ましくないことが起きそう）
  "relief", // 安堵（心配していたことが外れた）
  "disappointment", // がっかり（期待していたことが外れた）
  "pride", // 誇らしさ（自分の行いが称賛に値する）
  "shame", // 恥ずかしさ・ふがいなさ（自分の行いが非難に値する）
  "gratitude", // 感謝（相手の行いで、自分に望ましいことが起きた）
  "admiration", // 感心（相手の行いが称賛に値する）
  "anger", // 怒り・いらだち（相手の行いで、自分に望ましくないことが起きた）
  "happyFor", // 自分のことのようにうれしい（相手に望ましいことが起きた）
  "sympathy", // 心配・同情（相手に望ましくないことが起きた）
] as const;

export type EmotionKey = (typeof EMOTION_KEYS)[number];

/** 情動の強さ（各 0〜100。0 が平常） */
export type Emotions = Record<EmotionKey, number>;

/** 気分（PAD の3次元。各 -100〜+100。平常値は性格で決まる） */
export interface MoodPad {
  pleasure: number; // 快（+）・不快（-）
  arousal: number; // 覚醒（+）・沈静（-）
  dominance: number; // 支配性（+: 自信がある・主導している）・服従性（-）
}

/** 欲求（各 0〜100。高いほど不足している・たまっている） */
export interface Needs {
  fatigue: number; // 疲労
  loneliness: number; // 孤独感
}

/** 関係値の寄与（軸ごとの差分。書いていない軸は 0） */
export type PerceptionContribution = Partial<Record<keyof Perception, number>>;

/**
 * セッション（会話のまとまり）の途中経過。関係値は発言ごとには動かさず、
 * セッションが終わったときに、軸ごとに peak と last の平均を1回だけ反映する（ピーク・エンドの法則）。
 */
export interface PendingSession {
  startedAt: string; // セッションの最初の発言の日時（ISO8601）
  lastMessageAt: string; // 最後の発言の日時（ISO8601）。ここから一定時間あいたらセッションの終わり
  messageCount: number;
  peak: PerceptionContribution; // 軸ごとに、絶対値がいちばん大きかった寄与（符号つき）
  last: PerceptionContribution; // 最後の発言の寄与
}

/** その段階に入ったときの関係値（釣り鐘の減衰の「下端」に使う） */
export interface PerceptionStageBase {
  stageKey: string;
  values: Perception;
}

/** 感情・関係値の状態（状態レコード index = "state" の中身。stateVersion = 2） */
export interface CharacterAffectState {
  emotions: Emotions;
  mood: MoodPad;
  needs: Needs;
  perception: Perception;
  perceptionStageBase: PerceptionStageBase | null; // まだ段階を見ていなければ null
  pendingSession: PendingSession | null; // 進行中のセッションが無ければ null
  affectUpdatedAt: string; // 時間による変化の基準の日時（ISO8601）。この時点の値を保存している
}

/** 出来事の評価（emotionUpdater の LLM の出力の1要素。サーバーが検証してから使う） */
export interface Appraisal {
  summary: string; // 何が起きたか（ログ用）
  desirabilityForSelf: number; // キャラクターにとっての望ましさ（-3〜+3 の整数）
  desirabilityForPlayer: number; // プレイヤーにとっての望ましさ（-3〜+3 の整数。プレイヤーに起きた出来事でなければ 0）
  prospect: AppraisalProspect;
  cause: AppraisalCause;
  praiseworthiness: number; // 原因になった行いが称賛に値するか（-3〜+3 の整数。行いでなければ 0）
  relatedGoalKey: string | null; // 関係する目標（CharacterGoal.key）。無ければ null
}

/** happened: 起きた／anticipated: これから起きそう／avoided: 心配が外れた／missed: 期待が外れた */
export type AppraisalProspect = "happened" | "anticipated" | "avoided" | "missed";

/** 出来事の原因。player: プレイヤー／self: キャラクター自身／other: ほかの人／circumstance: 誰のせいでもない */
export type AppraisalCause = "player" | "self" | "other" | "circumstance";

/** プレイヤーとのやり取りの分類（emotionUpdater の process=2 の LLM の出力。関係値に使う） */
export interface InteractionLabels {
  playerSelfDisclosure: "none" | "fact" | "emotion"; // プレイヤーが自分のことを話したか（事実／気持ち）
  // キャラクターが直前に弱音・本音を出していたとき、プレイヤーがどう応じたか
  responseToCharacterDisclosure: "not_applicable" | "responsive" | "neutral" | "dismissive";
  helpedCharacter: boolean; // キャラクターが困っていることに、プレイヤーが助けになったか
  rememberedPastTopic: boolean; // プレイヤーが、前に話したことを覚えていて触れたか
}

/** 情動への加算（評価から決まる。どの出来事の、誰が原因の情動か） */
export interface EmotionImpulse {
  emotion: EmotionKey;
  intensity: number; // 加える強さ（0 より大きい）
  cause: AppraisalCause;
  summary: string; // もとの評価の summary（ログ用）
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

/** 記憶の感情の向き（気分一致効果〔Bower 1981〕の照合に使う。D-040 フェーズ13a） */
export type EmotionValence = "positive" | "negative" | "neutral";

export interface MemoryCandidate {
  shouldRemember: boolean;
  eventSummary: string;
  playerAction: string;
  characterInterpretation: string;
  emotion: string;
  emotionValence?: EmotionValence;
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
  emotionValence?: EmotionValence; // 気分一致の記憶に使う（D-040 フェーズ13a）
  reason?: string;
  updatedAt?: string;
}

/** 感情・関係値の状態レコード（index = "state"、stateVersion = 2。D-040） */
export interface CharacterAffectStateItem extends CharacterAffectState {
  memory_id: string;
  index: "state";
  stateVersion: 2;
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

/**
 * process=1（ログイン時）。入力は最新の不在期間の記録で、DynamoDB から読む（D-022）。
 * D-040: lifestyle（疲労の計算に使う）・now（状態を進める基準時刻。ISO8601）を持つ
 */
export interface EmotionUpdaterRequestProcess1 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  now: string; // ISO8601
  process: 1;
}

export interface EmotionUpdaterRequestProcess2 {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  now: string; // ISO8601
  process: 2;
  playerMessage: string;
}

export type EmotionUpdaterRequest =
  | EmotionUpdaterRequestProcess1
  | EmotionUpdaterRequestProcess2;

/** D-040: 差分（mood/perceptionDelta）ではなく、更新後の状態をそのまま返す */
export interface EmotionUpdaterResponse {
  emotions: Emotions;
  mood: MoodPad;
  needs: Needs;
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
  lifestyle: Lifestyle; // 感情・関係値の状態を now まで進めるのに使う（affectStateStore.ts。D-040）
  now: string; // ISO8601
  message: string; // 空文字の場合はプレイヤー不在時の代替テキストを内部で使用
  // mood/perception はリクエストで渡さず、常に DynamoDB から取得する（D-032）
  longTimeFlag?: 0 | 1; // D-040 で使わなくなった。廃止した項目と同じく、受け取るが無視する（不在期間の出来事・行動は最新の記録を DynamoDB から読む。D-022）
}

export interface DialogueGeneratorResponse {
  reply: string;
}

// -------------------------------------------------------
// debugCharacterState（デバッグ専用。.notes/done/debug-character-state-roadmap.md）
// -------------------------------------------------------

/**
 * emotions/mood/needs/perception を直接指定して状態レコード（CharacterAffectState、
 * D-040）を書き換えるデバッグ専用の入力。`world`/`lifestyle` は
 * `loadProjectedAffectState`（now まで状態を進める）に使う。
 * 見出し（`emotions`/`mood`/`needs`/`perception`）ごとに省略でき、
 * すべて省略すれば読み取りのみ（保存しない）。
 */
export interface DebugCharacterStateRequest {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lifestyle: Lifestyle;
  now: string; // ISO8601（/dialogue-generator と同じ扱い。front-web の仮想時刻）
  emotions?: Emotions;
  mood?: MoodPad;
  // fatigue は生活様式と時刻から毎回計算し直すため、loneliness だけを書き換え対象にする
  needs?: { loneliness: number };
  perception?: Perception; // 関係の段階の上限は無視して書ける（デバッグ用）
}

/** now まで進めた（書き換えがあれば反映した）状態と、今の関係の段階を返す */
export interface DebugCharacterStateResponse {
  emotions: Emotions;
  mood: MoodPad;
  needs: Needs;
  perception: Perception;
  pendingSession: PendingSession | null;
  stage: { key: string; label: string; maxPerception: Partial<Perception> }; // maxPerception は書いてある軸だけ（無ければ {}）
  affectUpdatedAt: string;
}
