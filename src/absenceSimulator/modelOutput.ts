// -------------------------------------------------------
// LLM の出力と骨格の突き合わせ
//
// 不在期間のシミュレーションで LLM に出力させた JSON（AbsenceSimulatorModelOutput）
// を、骨格（AbsenceSkeleton）・前回の続いている話題（AbsenceThread[]）と突き合わせ、
// 保存する記録（AbsenceRecord）を組み立てる。LLM の出力は信用せず、すべて検証してから
// 使う。突き合わせの規則は .notes/decision-history.md の D-020 を参照。
// -------------------------------------------------------

import type {
  AbsenceEvent,
  AbsenceRecord,
  AbsenceSkeleton,
  AbsenceThread,
  Action,
} from "../types.js";

/** LLM に出力させる形（プロンプトの出力フォーマットと同じ）。値は信用せず、すべて検証してから使う */
export interface AbsenceSimulatorModelOutput {
  events?: unknown;
  actions?: unknown;
  threadUpdates?: unknown;
  newThreads?: unknown;
}

/** LLM の呼び出しが失敗したとき（invokeModelJson の fallback）に使う、空の出力 */
export const EMPTY_MODEL_OUTPUT: AbsenceSimulatorModelOutput = {
  events: [],
  actions: [],
  threadUpdates: [],
  newThreads: [],
};

/** 同時に続けられる話題の最大件数。超えたら openedAt の古いものから閉じる（D-020） */
export const MAX_OPEN_THREADS = 3;

/** 1回のシミュレーションで新しく始められる話題の最大件数（D-020） */
export const MAX_NEW_THREADS_PER_SIMULATION = 2;

/** 続いている話題を自動で閉じるまでの日数（D-020） */
export const THREAD_AUTO_CLOSE_DAYS = 14;

const THREAD_AUTO_CLOSE_MS = THREAD_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000;

/**
 * 前回の記録の話題（previousThreads）から、プロンプトに渡す「続いている話題」を選ぶ。
 *
 * - status が "open" のものだけを対象にする（closed は無視する）。
 * - openedAt が baseDatetime から THREAD_AUTO_CLOSE_DAYS 日以上前のものは、
 *   この時点で自動的に閉じるべき話題として扱うため、対象から外す
 *   （buildAbsenceRecord 側で実際に closed にする処理と、同じ絞り込みにする）。
 * - openedAt の新しい順に並べ、最大 MAX_OPEN_THREADS 件を返す。
 */
export function selectOpenThreadsForPrompt(
  previousThreads: AbsenceThread[],
  baseDatetime: string
): AbsenceThread[] {
  const baseMs = new Date(baseDatetime).getTime();

  return previousThreads
    .filter((thread) => thread.status === "open")
    .filter((thread) => baseMs - new Date(thread.openedAt).getTime() < THREAD_AUTO_CLOSE_MS)
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
    .slice(0, MAX_OPEN_THREADS);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** 手順2: 出来事の突き合わせ */
function buildEvents(
  modelOutput: AbsenceSimulatorModelOutput,
  skeleton: AbsenceSkeleton,
  openThreadIds: ReadonlySet<string>
): AbsenceEvent[] {
  const rawEvents = modelOutput.events;
  if (!Array.isArray(rawEvents)) return [];

  const events: AbsenceEvent[] = [];
  for (const raw of rawEvents) {
    if (events.length >= skeleton.eventKinds.length) break;
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as Record<string, unknown>;
    if (!isNonEmptyString(v.summary) || !isNonEmptyString(v.detail)) continue;

    const kind = skeleton.eventKinds[events.length].key;
    const event: AbsenceEvent = {
      kind,
      summary: v.summary.trim(),
      detail: v.detail.trim(),
    };
    if (typeof v.threadId === "string" && openThreadIds.has(v.threadId)) {
      event.threadId = v.threadId;
    }
    events.push(event);
  }
  return events;
}

/** 手順3: 行動の突き合わせ */
function buildActions(
  modelOutput: AbsenceSimulatorModelOutput,
  skeleton: AbsenceSkeleton
): Action[] {
  const rawActions = Array.isArray(modelOutput.actions) ? modelOutput.actions : [];

  return skeleton.actionSlots.map((slot, i) => {
    const slotNumber = i + 1;
    const match = rawActions.find((raw): raw is Record<string, unknown> => {
      if (typeof raw !== "object" || raw === null) return false;
      const v = raw as Record<string, unknown>;
      return v.index === slotNumber && isNonEmptyString(v.action);
    });

    return {
      startDatetime: slot.startDatetime,
      endDatetime: slot.endDatetime,
      action: match ? (match.action as string).trim() : slot.activity,
      memo: match && typeof match.memo === "string" ? match.memo.trim() : "",
    };
  });
}

/** 手順4: LLM による続きの話題のクローズ（既知の open な話題を "closed" にする） */
function applyThreadUpdates(
  modelOutput: AbsenceSimulatorModelOutput,
  openThreads: AbsenceThread[]
): { open: AbsenceThread[]; closedNow: AbsenceThread[] } {
  const rawUpdates = Array.isArray(modelOutput.threadUpdates) ? modelOutput.threadUpdates : [];

  const idsToClose = new Set<string>();
  for (const raw of rawUpdates) {
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as Record<string, unknown>;
    if (typeof v.id === "string" && v.status === "closed") {
      idsToClose.add(v.id);
    }
  }

  const open: AbsenceThread[] = [];
  const closedNow: AbsenceThread[] = [];
  for (const thread of openThreads) {
    if (idsToClose.has(thread.id)) {
      closedNow.push({ ...thread, status: "closed" });
    } else {
      open.push(thread);
    }
  }
  return { open, closedNow };
}

/** 手順5: 新しい話題 */
function buildNewThreads(
  modelOutput: AbsenceSimulatorModelOutput,
  existingOpenTopics: ReadonlySet<string>,
  createdAt: string,
  createThreadId: () => string
): AbsenceThread[] {
  const rawNewThreads = Array.isArray(modelOutput.newThreads) ? modelOutput.newThreads : [];

  const usedTopics = new Set(existingOpenTopics);
  const newThreads: AbsenceThread[] = [];
  for (const raw of rawNewThreads) {
    if (newThreads.length >= MAX_NEW_THREADS_PER_SIMULATION) break;
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as Record<string, unknown>;
    if (!isNonEmptyString(v.topic)) continue;

    const topic = v.topic.trim();
    if (usedTopics.has(topic)) continue;
    usedTopics.add(topic);

    newThreads.push({
      id: createThreadId(),
      topic,
      status: "open",
      openedAt: createdAt,
    });
  }
  return newThreads;
}

/** 骨格と LLM の出力から、保存する記録を組み立てる（D-020） */
export function buildAbsenceRecord(args: {
  eventId: string;
  characterId: string;
  createdAt: string;
  skeleton: AbsenceSkeleton;
  previousThreads: AbsenceThread[];
  modelOutput: AbsenceSimulatorModelOutput;
  createThreadId: () => string;
}): AbsenceRecord {
  const { eventId, characterId, createdAt, skeleton, previousThreads, modelOutput, createThreadId } =
    args;

  // 手順1: 続いている話題の準備（自動クローズを含む）。
  const carriedOpenThreads = selectOpenThreadsForPrompt(previousThreads, createdAt);
  const carriedOpenIds = new Set(carriedOpenThreads.map((t) => t.id));
  const autoClosedThreads = previousThreads
    .filter((thread) => thread.status === "open" && !carriedOpenIds.has(thread.id))
    .map((thread): AbsenceThread => ({ ...thread, status: "closed" }));

  const openThreadIds = new Set(carriedOpenThreads.map((t) => t.id));

  // 手順2: 出来事。
  const events = buildEvents(modelOutput, skeleton, openThreadIds);

  // 手順3: 行動。
  const actions = buildActions(modelOutput, skeleton);

  // 手順4: LLM による続きの話題のクローズ。
  const { open: openAfterUpdates, closedNow: closedByLlm } = applyThreadUpdates(
    modelOutput,
    carriedOpenThreads
  );

  // 手順5: 新しい話題。
  const existingOpenTopics = new Set(openAfterUpdates.map((t) => t.topic));
  const newThreads = buildNewThreads(modelOutput, existingOpenTopics, createdAt, createThreadId);

  // 手順6: 上限を超えたら openedAt の古いものから閉じる。
  const allOpen = [...openAfterUpdates, ...newThreads];
  allOpen.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  const finalOpen = allOpen.slice(0, MAX_OPEN_THREADS);
  const overflowClosed = allOpen
    .slice(MAX_OPEN_THREADS)
    .map((thread): AbsenceThread => ({ ...thread, status: "closed" }));

  // 手順7: 記録の threads（open を先、各グループ内は openedAt の古い順）。
  const sortByOpenedAtAsc = (a: AbsenceThread, b: AbsenceThread) =>
    new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime();

  const openSorted = [...finalOpen].sort(sortByOpenedAtAsc);
  const closedNowSorted = [...autoClosedThreads, ...closedByLlm, ...overflowClosed].sort(
    sortByOpenedAtAsc
  );

  return {
    event_id: eventId,
    characterId,
    createdAt,
    startDatetime: skeleton.startDatetime,
    endDatetime: skeleton.endDatetime,
    events,
    actions,
    threads: [...openSorted, ...closedNowSorted],
  };
}
