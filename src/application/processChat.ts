// -------------------------------------------------------
// processChat
// フロントからのリクエストを受け取り、プロセスを振り分けて
// レスポンスを生成する一連の処理をまとめたオーケストレーター。
//
// プロセス1（世界シミュレーション）: message="" のとき
//   1-1: 3時間以上2週間未満 → eventResolver→actionPlanner→emotionUpdater→memoryRetriever→dialogueGenerator
//   1-2: 2週間以上          → 同上 + longTimeFlag=1 で dialogueGenerator を呼ぶ
//   1-3: 3時間未満          → 固定返却 "こんにちは"
// プロセス2（応答生成）: message に内容があるとき
//   dialogueGenerator→emotionUpdater→memoryRetriever
// -------------------------------------------------------

import type { ChatResponse, NormalizedRequest } from "../types.js";
import { runEventResolver } from "../eventResolver/index.js";
import { runActionPlanner } from "../actionPlanner/index.js";
import { runEmotionUpdater } from "../emotionUpdater/index.js";
import { runMemoryRetriever } from "../memoryRetriever/index.js";
import { runDialogueGenerator } from "../dialogueGenerator/index.js";

// プロセス1-3 で返す固定挨拶リスト（将来的にはランダム選択を想定）
const INIT_CONVERSATION = ["こんにちは"];

const HOURS_3 = 3;
const HOURS_2WEEKS = 24 * 14;

export async function processChat(req: NormalizedRequest): Promise<ChatResponse> {
  const { message, elapsedHours } = req;

  // ------------------------------------------------
  // プロセス1: ログイン時（message が空欄）
  // ------------------------------------------------
  if (message === "") {
    console.log(`[processChat] Process1 elapsed=${elapsedHours.toFixed(1)}h`);

    // 1-3: 3時間未満 → 固定返却
    if (elapsedHours < HOURS_3) {
      console.log("[processChat] Process1-3: short interval, returning fixed greeting");
      return buildFixedResponse(req, INIT_CONVERSATION[0]);
    }

    // 1-2: 2週間以上 / 1-1: 3時間以上2週間未満
    const longTimeFlag = elapsedHours >= HOURS_2WEEKS ? 1 : 0;
    if (longTimeFlag) {
      console.log("[processChat] Process1-2: long absence (>=2weeks)");
    } else {
      console.log("[processChat] Process1-1: normal absence (3h-2weeks)");
    }

    // eventResolver → actionPlanner
    const eventResult = await runEventResolver(req);
    console.log("[processChat] eventResolver response:", JSON.stringify(eventResult));

    const actionResult = await runActionPlanner(req, eventResult);
    console.log("[processChat] actionPlanner response:", JSON.stringify(actionResult));

    // emotionUpdater（イベント・アクションをインプット）
    const { mood, perception } = await runEmotionUpdater({
      req,
      process: 1,
      events: eventResult.events,
      actions: actionResult.actions,
    });
    console.log("[processChat] emotionUpdater response:", JSON.stringify({ mood, perception }));

    // memoryRetriever（イベント・アクションを判定）
    await runMemoryRetriever({
      req,
      process: 1,
      events: eventResult.events,
      actions: actionResult.actions,
    });
    console.log("[processChat] memoryRetriever done");

    // dialogueGenerator（空メッセージ → キャラクターから話しかける）
    const reply = await runDialogueGenerator({
      req,
      mood,
      perception,
      events: eventResult.events,
      actions: actionResult.actions,
      longTimeFlag,
    });
    console.log("[processChat] dialogueGenerator response:", reply);

    return {
      characterId: req.characterId,
      reply,
      mood,
      perception,
      actions: actionResult.actions,
    };
  }

  // ------------------------------------------------
  // プロセス2: 応答生成（message に内容あり）
  // ------------------------------------------------
  console.log("[processChat] Process2: response generation");

  // dialogueGenerator（プレイヤー発言に応答）
  // この時点では感情値を DynamoDB から読んで渡す（emotionUpdater 前の現在値）
  const reply = await runDialogueGenerator({
    req,
    mood: undefined,   // dialogueGenerator 内部で DynamoDB から取得する
    perception: undefined,
    events: [],
    actions: req.actions,
    longTimeFlag: 0,
  });
  console.log("[processChat] dialogueGenerator response:", reply);

  // emotionUpdater（プレイヤーの発言をインプット）
  const { mood, perception } = await runEmotionUpdater({
    req,
    process: 2,
    playerMessage: message,
  });
  console.log("[processChat] emotionUpdater response:", JSON.stringify({ mood, perception }));

  // memoryRetriever（5往復ごとに判定）
  await runMemoryRetriever({
    req,
    process: 2,
  });
  console.log("[processChat] memoryRetriever done");

  return {
    characterId: req.characterId,
    reply,
    mood,
    perception,
  };
}

// -------------------------------------------------------
// ヘルパー
// -------------------------------------------------------

function buildFixedResponse(req: NormalizedRequest, greeting: string): ChatResponse {
  // プロセス1-3 は感情更新不要。現在値をそのまま返すため
  // ここでは mood/perception のデフォルト値を返す。
  // 実際の値は次回プロセス2のレスポンスで更新される。
  return {
    characterId: req.characterId,
    reply: greeting,
    mood: {
      joy: 35,
      anxiety: 62,
      angry: 20,
      fatigue: 48,
      confidence: 30,
      loneliness: 10,
    },
    perception: {
      trust: 72,
      affection: 55,
      respect: 80,
      fear: 12,
      dependence: 30,
      familiarity: 65,
    },
  };
}
