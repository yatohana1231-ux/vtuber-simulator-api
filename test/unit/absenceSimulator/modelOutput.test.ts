import { describe, it, expect } from "vitest";
import {
  buildAbsenceRecord,
  selectOpenThreadsForPrompt,
  EMPTY_MODEL_OUTPUT,
  MAX_OPEN_THREADS,
  MAX_NEW_THREADS_PER_SIMULATION,
  THREAD_AUTO_CLOSE_DAYS,
  type AbsenceSimulatorModelOutput,
} from "../../../src/absenceSimulator/modelOutput.js";
import type { AbsenceSkeleton, AbsenceThread } from "../../../src/types.js";

const CREATED_AT = "2026-09-18T00:00:00.000Z";

function daysBefore(base: string, days: number): string {
  return new Date(new Date(base).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursBefore(base: string, hours: number): string {
  return new Date(new Date(base).getTime() - hours * 60 * 60 * 1000).toISOString();
}

function thread(id: string, topic: string, status: "open" | "closed", openedAt: string): AbsenceThread {
  return { id, topic, status, openedAt };
}

function skeletonWith(args: {
  eventKindKeys: string[];
  actionSlots?: AbsenceSkeleton["actionSlots"];
}): AbsenceSkeleton {
  return {
    startDatetime: "2026-09-17T00:00:00.000Z",
    endDatetime: CREATED_AT,
    actionSlots:
      args.actionSlots ??
      [
        { startDatetime: "2026-09-17T22:00:00.000Z", endDatetime: "2026-09-17T23:00:00.000Z", activity: "学校" },
        { startDatetime: "2026-09-17T23:00:00.000Z", endDatetime: CREATED_AT, activity: "就寝" },
      ],
    eventKinds: args.eventKindKeys.map((key) => ({ key, label: key, weight: 1 })),
  };
}

function buildIdGenerator(ids: string[]): () => string {
  let i = 0;
  return () => {
    const id = ids[i];
    i += 1;
    return id;
  };
}

describe("selectOpenThreadsForPrompt", () => {
  it("closed の話題は除かれる", () => {
    const threads = [thread("t1", "テストの話", "closed", CREATED_AT)];
    expect(selectOpenThreadsForPrompt(threads, CREATED_AT)).toEqual([]);
  });

  it("openedAt が14日以上前の open な話題は除かれる", () => {
    const threads = [thread("t1", "古い話", "open", daysBefore(CREATED_AT, 14))];
    expect(selectOpenThreadsForPrompt(threads, CREATED_AT)).toEqual([]);
  });

  it("openedAt が14日未満前の open な話題は残る", () => {
    const threads = [thread("t1", "少し前の話", "open", daysBefore(CREATED_AT, 13.9))];
    expect(selectOpenThreadsForPrompt(threads, CREATED_AT)).toEqual(threads);
  });

  it("open な話題が上限を超える場合は openedAt の新しい順に上限件数まで返す", () => {
    const threads = [
      thread("t1", "話題1", "open", daysBefore(CREATED_AT, 4)),
      thread("t2", "話題2", "open", daysBefore(CREATED_AT, 1)),
      thread("t3", "話題3", "open", daysBefore(CREATED_AT, 3)),
      thread("t4", "話題4", "open", daysBefore(CREATED_AT, 2)),
    ];
    const result = selectOpenThreadsForPrompt(threads, CREATED_AT);
    expect(result.map((t) => t.id)).toEqual(["t2", "t4", "t3"]);
    expect(result).toHaveLength(MAX_OPEN_THREADS);
  });
});

describe("buildAbsenceRecord / 出来事の突き合わせ", () => {
  it("出来事の件数が骨格の件数より少ない場合はその件数だけになる", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily", "small-joy", "discovery"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [{ summary: "要約1", detail: "詳細1" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events).toEqual([{ kind: "daily", summary: "要約1", detail: "詳細1" }]);
  });

  it("出来事の件数が骨格の件数より多い場合は骨格の件数までに切り詰める", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [
        { summary: "要約1", detail: "詳細1" },
        { summary: "要約2", detail: "詳細2" },
      ],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events).toEqual([{ kind: "daily", summary: "要約1", detail: "詳細1" }]);
  });

  it("一部の出来事が不正（summary/detail が空文字）な場合はその要素だけ除いて残りを採用する", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily", "small-joy"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [
        { summary: "  ", detail: "詳細1" },
        { summary: "要約2", detail: "詳細2" },
      ],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    // 不正な1件目は除かれ、正しい2件目が先頭（kind="daily"）として採用される
    expect(record.events).toEqual([{ kind: "daily", summary: "要約2", detail: "詳細2" }]);
  });

  it("summary/detail は trim される", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [{ summary: "  要約1  ", detail: "  詳細1  " }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events[0].summary).toBe("要約1");
    expect(record.events[0].detail).toBe("詳細1");
  });

  it("kind は LLM の値を無視し、同じ位置の骨格の eventKinds の key を使う", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["small-trouble"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [{ kind: "made-up-kind", summary: "要約1", detail: "詳細1" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events[0].kind).toBe("small-trouble");
  });

  it("threadId が続いている話題の id と一致する場合は残す", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily"] });
    const previousThreads = [thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1))];
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [{ summary: "要約1", detail: "詳細1", threadId: "t1" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events[0].threadId).toBe("t1");
  });

  it("threadId が未知（続いている話題に無い）場合は付けない", () => {
    const skeleton = skeletonWith({ eventKindKeys: ["daily"] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      events: [{ summary: "要約1", detail: "詳細1", threadId: "unknown-thread" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events[0].threadId).toBeUndefined();
  });
});

describe("buildAbsenceRecord / 行動の突き合わせ", () => {
  const actionSlots: AbsenceSkeleton["actionSlots"] = [
    { startDatetime: "2026-09-17T21:00:00.000Z", endDatetime: "2026-09-17T22:00:00.000Z", activity: "部活" },
    { startDatetime: "2026-09-17T22:00:00.000Z", endDatetime: "2026-09-17T23:00:00.000Z", activity: "配信" },
    { startDatetime: "2026-09-17T23:00:00.000Z", endDatetime: CREATED_AT, activity: "就寝" },
  ];

  it("番号が一致する行動は action と memo を採用し、時刻は骨格の値を使う", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [
        { index: 1, action: "友達と部活を頑張った", memo: "楽しかった" },
        { index: 2, action: "配信で新しい歌を披露した", memo: "" },
        { index: 3, action: "いつもより早く寝た", memo: "少し疲れていた" },
      ],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions).toEqual([
      { startDatetime: actionSlots[0].startDatetime, endDatetime: actionSlots[0].endDatetime, action: "友達と部活を頑張った", memo: "楽しかった" },
      { startDatetime: actionSlots[1].startDatetime, endDatetime: actionSlots[1].endDatetime, action: "配信で新しい歌を披露した", memo: "" },
      { startDatetime: actionSlots[2].startDatetime, endDatetime: actionSlots[2].endDatetime, action: "いつもより早く寝た", memo: "少し疲れていた" },
    ]);
  });

  it("番号が欠けている枠は生活リズムの activity を使い、memo は空文字になる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: 1, action: "友達と部活を頑張った", memo: "楽しかった" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[1]).toEqual({
      startDatetime: actionSlots[1].startDatetime,
      endDatetime: actionSlots[1].endDatetime,
      action: "配信",
      memo: "",
    });
    expect(record.actions[2]).toEqual({
      startDatetime: actionSlots[2].startDatetime,
      endDatetime: actionSlots[2].endDatetime,
      action: "就寝",
      memo: "",
    });
  });

  it("番号が重複している場合は最初の要素を使う", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [
        { index: 1, action: "最初の候補", memo: "" },
        { index: 1, action: "2番目の候補", memo: "" },
      ],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[0].action).toBe("最初の候補");
  });

  it("骨格の枠に無い番号（範囲外）は無視される", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: 99, action: "範囲外の行動", memo: "" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions.map((a) => a.action)).toEqual(["部活", "配信", "就寝"]);
  });

  it("index が数値でない（不正な型）場合はその要素は使わず、生活リズムの activity になる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: "1", action: "文字列の番号", memo: "" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[0]).toEqual({
      startDatetime: actionSlots[0].startDatetime,
      endDatetime: actionSlots[0].endDatetime,
      action: "部活",
      memo: "",
    });
  });

  it("action が空文字（trim 後）の要素は使わず、生活リズムの activity になる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: 1, action: "   ", memo: "メモだけ" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[0].action).toBe("部活");
    expect(record.actions[0].memo).toBe("");
  });

  it("memo が文字列でない場合は空文字にする", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: 1, action: "友達と部活を頑張った", memo: 123 }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[0].memo).toBe("");
  });

  it("memo が無い（未指定）場合は空文字にする", () => {
    const skeleton = skeletonWith({ eventKindKeys: [], actionSlots });
    const modelOutput: AbsenceSimulatorModelOutput = {
      actions: [{ index: 1, action: "友達と部活を頑張った" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.actions[0].memo).toBe("");
  });
});

describe("buildAbsenceRecord / 続きの話題の更新", () => {
  it("開いてから14日ちょうどの話題は自動で閉じる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [thread("t1", "ちょうど14日前の話", "open", daysBefore(CREATED_AT, THREAD_AUTO_CLOSE_DAYS))];
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual([{ ...previousThreads[0], status: "closed" }]);
  });

  it("開いてから14日直前の話題は開いたままになる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [
      thread("t1", "14日直前の話", "open", daysBefore(CREATED_AT, THREAD_AUTO_CLOSE_DAYS - 0.001)),
    ];
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual(previousThreads);
  });

  it("LLM が threadUpdates で closed にした既知の話題は閉じる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1))];
    const modelOutput: AbsenceSimulatorModelOutput = {
      threadUpdates: [{ id: "t1", status: "closed" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual([{ ...previousThreads[0], status: "closed" }]);
  });

  it("threadUpdates の status が open の場合は無視して開いたままにする", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1))];
    const modelOutput: AbsenceSimulatorModelOutput = {
      threadUpdates: [{ id: "t1", status: "open" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual(previousThreads);
  });

  it("threadUpdates に未知の id が来ても無視する", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1))];
    const modelOutput: AbsenceSimulatorModelOutput = {
      threadUpdates: [{ id: "unknown-id", status: "closed" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual(previousThreads);
  });

  it("前回すでに closed だった話題は引き継がない", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [
      thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1)),
      thread("t2", "前回すでに終わった話", "closed", daysBefore(CREATED_AT, 5)),
    ];
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("新しい話題は空の場合は追加されない", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.threads).toEqual([]);
  });

  it("新しい話題は1回に最大2件までしか追加されない", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      newThreads: [{ topic: "話題A" }, { topic: "話題B" }, { topic: "話題C" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator(["new-1", "new-2", "new-3"]),
    });
    expect(record.threads).toHaveLength(MAX_NEW_THREADS_PER_SIMULATION);
    expect(record.threads.map((t) => t.topic)).toEqual(["話題A", "話題B"]);
    expect(record.threads.every((t) => t.status === "open" && t.openedAt === CREATED_AT)).toBe(true);
  });

  it("既存の open な話題と topic が重複する新しい話題は追加されない", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [thread("t1", "話題A", "open", daysBefore(CREATED_AT, 1))];
    const modelOutput: AbsenceSimulatorModelOutput = {
      newThreads: [{ topic: "話題A" }, { topic: "話題B" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator(["new-1", "new-2"]),
    });
    // open のグループは openedAt の古い順（t1 が t1 昨日開始で新規話題より古い）
    expect(record.threads.map((t) => t.topic)).toEqual(["話題A", "話題B"]);
  });

  it("同じ回の新しい話題どうしで topic が重複する場合は最初の1件だけ追加する", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const modelOutput: AbsenceSimulatorModelOutput = {
      newThreads: [{ topic: "話題A" }, { topic: "話題A" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator(["new-1", "new-2"]),
    });
    expect(record.threads).toHaveLength(1);
    expect(record.threads[0].id).toBe("new-1");
  });

  it("open の話題が上限を超えたら openedAt の古いものから閉じる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const previousThreads = [
      thread("t1", "話題1（最も古い）", "open", daysBefore(CREATED_AT, 3)),
      thread("t2", "話題2", "open", daysBefore(CREATED_AT, 2)),
      thread("t3", "話題3", "open", daysBefore(CREATED_AT, 1)),
    ];
    const modelOutput: AbsenceSimulatorModelOutput = {
      newThreads: [{ topic: "新しい話題" }],
    };
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput,
      createThreadId: buildIdGenerator(["new-1"]),
    });
    const openIds = record.threads.filter((t) => t.status === "open").map((t) => t.id);
    const closedIds = record.threads.filter((t) => t.status === "closed").map((t) => t.id);
    // 最も古い t1（3日前開始）が上限超えで閉じられ、残りは openedAt の古い順
    expect(openIds).toEqual(["t2", "t3", "new-1"]);
    expect(closedIds).toEqual(["t1"]);
  });
});

describe("buildAbsenceRecord / フォールバック（LLM 呼び出し失敗時）", () => {
  it("EMPTY_MODEL_OUTPUT の場合、出来事は空・行動は生活リズムの文面になる", () => {
    const actionSlots: AbsenceSkeleton["actionSlots"] = [
      { startDatetime: "2026-09-17T22:00:00.000Z", endDatetime: "2026-09-17T23:00:00.000Z", activity: "学校" },
    ];
    const skeleton = skeletonWith({ eventKindKeys: ["daily"], actionSlots });
    const previousThreads = [thread("t1", "続いている話", "open", daysBefore(CREATED_AT, 1))];
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads,
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events).toEqual([]);
    expect(record.actions).toEqual([
      {
        startDatetime: actionSlots[0].startDatetime,
        endDatetime: actionSlots[0].endDatetime,
        action: actionSlots[0].activity,
        memo: "",
      },
    ]);
    expect(record.threads).toEqual(previousThreads);
  });

  it("フィールドの型が不正（events が文字列など）でも例外を出さずフォールバックする", () => {
    const actionSlots: AbsenceSkeleton["actionSlots"] = [
      { startDatetime: "2026-09-17T22:00:00.000Z", endDatetime: "2026-09-17T23:00:00.000Z", activity: "学校" },
    ];
    const skeleton = skeletonWith({ eventKindKeys: ["daily"], actionSlots });
    const modelOutput = {
      events: "not-an-array",
      actions: 123,
      threadUpdates: { id: "t1" },
      newThreads: null,
    } as unknown as AbsenceSimulatorModelOutput;
    const record = buildAbsenceRecord({
      eventId: "event-1",
      characterId: "char-1",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.events).toEqual([]);
    expect(record.actions).toEqual([
      {
        startDatetime: actionSlots[0].startDatetime,
        endDatetime: actionSlots[0].endDatetime,
        action: actionSlots[0].activity,
        memo: "",
      },
    ]);
    expect(record.threads).toEqual([]);
  });
});

describe("buildAbsenceRecord / 記録の他のフィールド", () => {
  it("startDatetime/endDatetime は骨格の値、event_id/characterId/createdAt は引数の値になる", () => {
    const skeleton = skeletonWith({ eventKindKeys: [] });
    const record = buildAbsenceRecord({
      eventId: "event-xyz",
      characterId: "char-xyz",
      createdAt: CREATED_AT,
      skeleton,
      previousThreads: [],
      modelOutput: EMPTY_MODEL_OUTPUT,
      createThreadId: buildIdGenerator([]),
    });
    expect(record.event_id).toBe("event-xyz");
    expect(record.characterId).toBe("char-xyz");
    expect(record.createdAt).toBe(CREATED_AT);
    expect(record.startDatetime).toBe(skeleton.startDatetime);
    expect(record.endDatetime).toBe(skeleton.endDatetime);
  });
});
