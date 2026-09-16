// -------------------------------------------------------
// キャラクター×世界観パッケージ（api/content/ 配下の JSON）
// -------------------------------------------------------

export interface World {
  key: string;
  name: string;
  description: string;
  rules: string[];
  forbiddenElements: string[];
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
// eventResolver
// -------------------------------------------------------

export interface EventResolverResult {
  UUID: string;
  startDatetime: string;
  endDatetime: string;
  elapsed: string;
  events: string[];
}

// -------------------------------------------------------
// actionPlanner
// -------------------------------------------------------

export interface Action {
  startDatetime: string;
  endDatetime: string;
  action: string;
  memo: string;
}

export interface ActionPlannerResult {
  actions: Action[];
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

export interface EventItem {
  event_id: string;
  characterId: string;
  startDatetime: string;
  endDatetime: string;
  elapsed: string;
  events: string[];
  createdAt: string;
}

// -------------------------------------------------------
// エンドポイントリクエスト/レスポンス型
//
// 機能ごとに独立した API エンドポイントとして公開するため、
// これまで NormalizedRequest にまとめていた入力を
// エンドポイントごとにフラットな型として定義する。
// オーケストレーション（どの順で呼ぶか）はフロント側の責務になる。
// -------------------------------------------------------

export interface EventResolverRequest {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lastLoginAt: string; // ISO8601
  now: string; // ISO8601
}

export interface ActionPlannerRequest {
  characterId: string;
  world: World;
  character: CharacterDefinition;
  lastLoginAt: string; // ISO8601
  now: string; // ISO8601
  events: string[]; // event-resolver エンドポイントの出力
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
