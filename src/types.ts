// -------------------------------------------------------
// リクエスト / レスポンス型
// -------------------------------------------------------

export interface CharacterProfile {
  name: string;
  personality: string;
  speechStyle: string;
  relationship: string;
}

export interface ChatRequest {
  characterId?: string;
  message: string;
  characterProfile?: Partial<CharacterProfile>;
  lastLoginAt?: string; // ISO8601 例: "2026-07-18T10:00:00"
  now?: string;         // ISO8601 例: "2026-07-18T13:00:00"
  actions?: Action[];   // フロントが保持したアクション履歴（プロセス2で送信）
}

export interface ChatResponse {
  characterId: string;
  reply: string;
  mood: Mood;
  perception: Perception;
  actions?: Action[];   // プロセス1で生成されたアクション履歴（フロントで保持）
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
// processChat 内部の引数型
// -------------------------------------------------------

export interface NormalizedRequest {
  characterId: string;
  message: string;
  profile: CharacterProfile;
  lastLoginAt: Date;
  now: Date;
  elapsedHours: number;
  actions: Action[]; // フロントから受け取ったアクション履歴（プロセス2用）
}
