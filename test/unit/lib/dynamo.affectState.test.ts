import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  dynamo,
  getStoredAffectState,
  saveCharacterAffectState,
  STATE_INDEX_KEY,
  CHARACTER_MEMORY_TABLE,
} from "../../../src/lib/dynamo.js";
import { EMOTION_KEYS } from "../../../src/types.js";
import type { CharacterAffectState, Emotions, Perception } from "../../../src/types.js";

function neutralEmotions(): Emotions {
  const emotions = {} as Emotions;
  for (const key of EMOTION_KEYS) emotions[key] = 0;
  return emotions;
}

function validPerception(overrides: Partial<Perception> = {}): Perception {
  return {
    trust: 40,
    affection: 30,
    respect: 50,
    fear: 5,
    dependence: 10,
    familiarity: 20,
    ...overrides,
  };
}

function affectState(overrides: Partial<CharacterAffectState> = {}): CharacterAffectState {
  return {
    emotions: neutralEmotions(),
    mood: { pleasure: 10, arousal: -5, dominance: 3 },
    needs: { fatigue: 20, loneliness: 5 },
    perception: validPerception(),
    perceptionStageBase: null,
    pendingSession: null,
    affectUpdatedAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getStoredAffectState", () => {
  it("レコードなし → stateもlegacyPerceptionもnull", async () => {
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    const result = await getStoredAffectState("char-1");

    expect(result).toEqual({ state: null, legacyPerception: null });
  });

  it("呼び出す → memory_id・indexでGetCommandを送信する", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({ Item: undefined } as never);

    await getStoredAffectState("char-1");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as GetCommand;
    expect(command.input.TableName).toBe(CHARACTER_MEMORY_TABLE);
    expect(command.input.Key).toEqual({ memory_id: "char-1", index: STATE_INDEX_KEY });
  });

  it("stateVersion=2で形が正しい → stateに中身を入れて返す（legacyPerceptionはnull）", async () => {
    const state = affectState();
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      stateVersion: 2,
      ...state,
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).toEqual(state);
    expect(result.legacyPerception).toBeNull();
  });

  it("stateVersionが無い旧形式（moodが6項目） → stateはnull、perceptionが正しければlegacyPerceptionに入る", async () => {
    const legacyPerception = validPerception({ trust: 72 });
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: legacyPerception,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).toBeNull();
    expect(result.legacyPerception).toEqual(legacyPerception);
  });

  it("旧形式でperceptionも壊れている → stateもlegacyPerceptionもnull", async () => {
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      mood: { joy: 35, anxiety: 62, angry: 20, fatigue: 48, confidence: 30, loneliness: 10 },
      perception: { trust: 72 }, // 軸が足りない壊れた形
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).toBeNull();
    expect(result.legacyPerception).toBeNull();
  });

  it("stateVersion=2でemotionsの項目が欠けている → stateはnullで警告を出し、perceptionが正しければlegacyPerceptionに入る", async () => {
    const legacyPerception = validPerception();
    const brokenEmotions = neutralEmotions();
    delete (brokenEmotions as Partial<Emotions>).joy; // 項目が欠けた壊れた形
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      stateVersion: 2,
      emotions: brokenEmotions,
      mood: { pleasure: 10, arousal: -5, dominance: 3 },
      needs: { fatigue: 20, loneliness: 5 },
      perception: legacyPerception,
      perceptionStageBase: null,
      pendingSession: null,
      affectUpdatedAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).toBeNull();
    expect(result.legacyPerception).toEqual(legacyPerception);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMessage = warnSpy.mock.calls[0][0] as string;
    expect(warnMessage).toContain("char-1");
    expect(warnMessage).toContain("emotions");
    // 値そのもの（欠けたemotionsの中身の数値など）はログに出さない
    expect(warnMessage).not.toContain("pleasure");
  });

  it("stateVersion=2でpendingSessionだけ壊れている → pendingSessionだけnullにして残りは使う", async () => {
    const state = affectState({
      pendingSession: {
        startedAt: "2026-01-15T00:00:00.000Z",
        lastMessageAt: "2026-01-15T00:05:00.000Z",
        messageCount: 3,
        peak: { affection: 2 },
        last: { affection: 1 },
      },
    });
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      stateVersion: 2,
      ...state,
      pendingSession: { startedAt: "2026-01-15T00:00:00.000Z" }, // messageCount等が無い壊れた形
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).not.toBeNull();
    expect(result.state?.pendingSession).toBeNull();
    expect(result.state?.emotions).toEqual(state.emotions);
    expect(result.state?.mood).toEqual(state.mood);
  });

  it("stateVersion=2でperceptionStageBaseだけ壊れている → perceptionStageBaseだけnullにして残りは使う", async () => {
    const state = affectState();
    const item = {
      memory_id: "char-1",
      index: STATE_INDEX_KEY,
      stateVersion: 2,
      ...state,
      perceptionStageBase: { stageKey: "acquainted" }, // valuesが無い壊れた形
      updatedAt: "2026-01-15T00:00:00.000Z",
    };
    vi.spyOn(dynamo, "send").mockResolvedValue({ Item: item } as never);

    const result = await getStoredAffectState("char-1");

    expect(result.state).not.toBeNull();
    expect(result.state?.perceptionStageBase).toBeNull();
    expect(result.state?.perception).toEqual(state.perception);
  });
});

describe("saveCharacterAffectState", () => {
  it("呼び出す → PutCommandにstateVersion・index・キー・updatedAtとstateの中身が入っている", async () => {
    const sendSpy = vi.spyOn(dynamo, "send").mockResolvedValue({} as never);
    const state = affectState();

    await saveCharacterAffectState("char-1", state);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as PutCommand;
    expect(command.input.TableName).toBe(CHARACTER_MEMORY_TABLE);
    const item = command.input.Item as Record<string, unknown>;
    expect(item.memory_id).toBe("char-1");
    expect(item.index).toBe(STATE_INDEX_KEY);
    expect(item.stateVersion).toBe(2);
    expect(typeof item.updatedAt).toBe("string");
    expect(item).toMatchObject(state);
  });

  it("保存した内容をgetStoredAffectStateで読むと同じstateになる（往復）", async () => {
    const state = affectState({ needs: { fatigue: 55, loneliness: 12 } });
    let savedItem: Record<string, unknown> | undefined;
    vi.spyOn(dynamo, "send").mockImplementation(async (command) => {
      if (command instanceof PutCommand) {
        savedItem = command.input.Item as Record<string, unknown>;
        return {} as never;
      }
      if (command instanceof GetCommand) {
        return { Item: savedItem } as never;
      }
      throw new Error("unexpected command");
    });

    await saveCharacterAffectState("char-1", state);
    const result = await getStoredAffectState("char-1");

    expect(result.state).toEqual(state);
  });
});
