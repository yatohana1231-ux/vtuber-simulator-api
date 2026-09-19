import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/dynamo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/dynamo.js")>();
  return {
    ...actual,
    getCharacterState: vi.fn(),
    saveCharacterState: vi.fn(),
  };
});

import { runDebugCharacterState } from "../../../src/debugCharacterState/index.js";
import { getCharacterState, saveCharacterState } from "../../../src/lib/dynamo.js";
import type { CharacterDefinition, Mood, Perception } from "../../../src/types.js";

const mockedGetCharacterState = vi.mocked(getCharacterState);
const mockedSaveCharacterState = vi.mocked(saveCharacterState);

const initialPerception: Perception = {
  trust: 50,
  affection: 50,
  respect: 50,
  fear: 10,
  dependence: 10,
  familiarity: 50,
};

const character: CharacterDefinition = {
  key: "test-character",
  name: "テストキャラ",
  personality: "",
  speechStyle: "",
  relationship: "",
  background: "",
  speechExamples: [],
  initialPerception,
  relationshipStages: [
    {
      key: "first",
      label: "テスト段階",
      description: "",
      speechStyle: "",
      speechExamples: [],
      promoteWhen: null,
    },
  ],
};

const currentMood: Mood = {
  joy: 40,
  anxiety: 50,
  angry: 20,
  fatigue: 30,
  confidence: 35,
  loneliness: 15,
};

const currentPerception: Perception = {
  trust: 60,
  affection: 55,
  respect: 70,
  fear: 12,
  dependence: 20,
  familiarity: 58,
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockedGetCharacterState.mockResolvedValue({ mood: currentMood, perception: currentPerception });
});

describe("mood/perceptionともに未指定 → 読み取りのみ", () => {
  it("saveCharacterStateを呼ばず、今の値（getCharacterStateの結果）を返す", async () => {
    const result = await runDebugCharacterState({ characterId: "char-1", character });

    expect(mockedSaveCharacterState).not.toHaveBeenCalled();
    expect(result).toEqual({ mood: currentMood, perception: currentPerception });
  });

  it("getCharacterStateにはcharacter.initialPerceptionが渡る", async () => {
    await runDebugCharacterState({ characterId: "char-1", character });

    expect(mockedGetCharacterState).toHaveBeenCalledWith("char-1", initialPerception);
  });
});

describe("moodのみ指定", () => {
  const newMood: Mood = {
    joy: 90,
    anxiety: 5,
    angry: 5,
    fatigue: 10,
    confidence: 95,
    loneliness: 5,
  };

  it("perceptionは今の値のまま保存し、保存後の値を返す", async () => {
    const result = await runDebugCharacterState({
      characterId: "char-1",
      character,
      mood: newMood,
    });

    expect(mockedSaveCharacterState).toHaveBeenCalledWith(
      "char-1",
      newMood,
      currentPerception
    );
    expect(result).toEqual({ mood: newMood, perception: currentPerception });
  });
});

describe("perceptionのみ指定", () => {
  const newPerception: Perception = {
    trust: 95,
    affection: 90,
    respect: 90,
    fear: 5,
    dependence: 80,
    familiarity: 95,
  };

  it("moodは今の値のまま保存し、保存後の値を返す", async () => {
    const result = await runDebugCharacterState({
      characterId: "char-1",
      character,
      perception: newPerception,
    });

    expect(mockedSaveCharacterState).toHaveBeenCalledWith(
      "char-1",
      currentMood,
      newPerception
    );
    expect(result).toEqual({ mood: currentMood, perception: newPerception });
  });
});

describe("mood・perceptionともに指定", () => {
  const newMood: Mood = {
    joy: 1,
    anxiety: 1,
    angry: 1,
    fatigue: 1,
    confidence: 1,
    loneliness: 1,
  };
  const newPerception: Perception = {
    trust: 100,
    affection: 100,
    respect: 100,
    fear: 100,
    dependence: 100,
    familiarity: 100,
  };

  it("両方とも指定した値のまま保存し、保存後の値を返す", async () => {
    const result = await runDebugCharacterState({
      characterId: "char-1",
      character,
      mood: newMood,
      perception: newPerception,
    });

    expect(mockedSaveCharacterState).toHaveBeenCalledWith("char-1", newMood, newPerception);
    expect(result).toEqual({ mood: newMood, perception: newPerception });
  });
});

describe("状態レコードが無いとき（getCharacterStateがinitialPerceptionベースの既定値を返す）", () => {
  it("その既定値を土台にして保存する（moodのみ指定の場合）", async () => {
    const defaultMood: Mood = {
      joy: 35,
      anxiety: 62,
      angry: 20,
      fatigue: 48,
      confidence: 30,
      loneliness: 10,
    };
    mockedGetCharacterState.mockResolvedValue({
      mood: defaultMood,
      perception: initialPerception,
    });

    const newMood: Mood = {
      joy: 70,
      anxiety: 20,
      angry: 10,
      fatigue: 20,
      confidence: 70,
      loneliness: 10,
    };

    const result = await runDebugCharacterState({
      characterId: "char-2",
      character,
      mood: newMood,
    });

    expect(mockedSaveCharacterState).toHaveBeenCalledWith("char-2", newMood, initialPerception);
    expect(result).toEqual({ mood: newMood, perception: initialPerception });
  });
});
