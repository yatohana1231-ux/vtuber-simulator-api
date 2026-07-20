/**
 * 各処理の単体テスト CLI
 *
 * 使い方:
 *   npx tsx scripts/test-runner.ts <process> [options]
 *
 * プロセス:
 *   eventResolver      - イベント生成
 *   actionPlanner      - アクション生成
 *   emotionUpdater     - 感情更新（プロセス1 or 2）
 *   memoryRetriever    - 重要記憶判定（プロセス1 or 2）
 *   dialogueGenerator  - 会話生成
 *   all                - プロセス1全体（eventResolver→actionPlanner→emotionUpdater→memoryRetriever→dialogueGenerator）
 *
 * 環境変数（.env or 直接指定）:
 *   BEDROCK_MODEL_ID, CHARACTER_MEMORY_TABLE, CONVERSATION_LOGS_TABLE, EVENTS_TABLE, AWS_REGION
 *
 * 例:
 *   npx tsx scripts/test-runner.ts eventResolver
 *   npx tsx scripts/test-runner.ts emotionUpdater --process 2 --message "今日は調子どう？"
 *   npx tsx scripts/test-runner.ts dialogueGenerator --longTimeFlag 1
 *   npx tsx scripts/test-runner.ts all
 */

import { parseArgs } from "util";

// 環境変数のデフォルト（stg 環境）
process.env.AWS_REGION ??= "ap-northeast-1";
process.env.BEDROCK_MODEL_ID ??= "apac.amazon.nova-lite-v1:0";
process.env.CHARACTER_MEMORY_TABLE ??= "v-simu-characters-memory-stg";
process.env.CONVERSATION_LOGS_TABLE ??= "vtuber-simu-conversation-log-stg";
process.env.EVENTS_TABLE ??= "v-simu-events-stg";

import { runEventResolver } from "../src/eventResolver/index.js";
import { runActionPlanner } from "../src/actionPlanner/index.js";
import { runEmotionUpdater } from "../src/emotionUpdater/index.js";
import { runMemoryRetriever } from "../src/memoryRetriever/index.js";
import { runDialogueGenerator } from "../src/dialogueGenerator/index.js";
import type { NormalizedRequest, EventResolverResult, ActionPlannerResult } from "../src/types.js";

// -------------------------------------------------------
// CLI 引数パース
// -------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    characterId: { type: "string", default: "d89c3b4f-9e27-4f5a-b8d1-7c4e2a91f6b3" },
    name: { type: "string", default: "ゆい" },
    personality: { type: "string", default: "明るく前向きだが、初対面では少し緊張する" },
    speechStyle: { type: "string", default: "初対面では丁寧語を使う" },
    relationship: { type: "string", default: "仲の良い幼馴染" },
    message: { type: "string", default: "" },
    lastLoginAt: { type: "string", default: "" },
    now: { type: "string", default: "" },
    process: { type: "string", default: "1" },
    longTimeFlag: { type: "string", default: "0" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const processName = positionals[0];

if (!processName || values.help) {
  console.log(`
Usage: npx tsx scripts/test-runner.ts <process> [options]

Processes:
  eventResolver      イベント生成
  actionPlanner      アクション生成（eventResolver の結果を内部で生成）
  emotionUpdater     感情更新
  memoryRetriever    重要記憶判定
  dialogueGenerator  会話生成
  all                プロセス1 全体パイプライン

Options:
  --characterId <id>       キャラクターID (default: テスト用UUID)
  --name <name>            キャラクター名 (default: ゆい)
  --personality <text>     性格
  --speechStyle <text>     話し方
  --relationship <text>    関係性
  --message <text>         プレイヤーメッセージ (default: "" = プロセス1)
  --lastLoginAt <iso>      前回ログイン (default: 6時間前)
  --now <iso>              現在時刻 (default: now)
  --process <1|2>          emotionUpdater/memoryRetriever のプロセス番号
  --longTimeFlag <0|1>     dialogueGenerator の長期不在フラグ
  -h, --help               ヘルプ表示
`);
  process.exit(0);
}

// -------------------------------------------------------
// リクエスト構築
// -------------------------------------------------------

const nowDate = values.now ? new Date(values.now) : new Date();
const lastLoginAtDate = values.lastLoginAt
  ? new Date(values.lastLoginAt)
  : new Date(nowDate.getTime() - 6 * 60 * 60 * 1000); // デフォルト6時間前

const req: NormalizedRequest = {
  characterId: values.characterId!,
  message: values.message!,
  profile: {
    name: values.name!,
    personality: values.personality!,
    speechStyle: values.speechStyle!,
    relationship: values.relationship!,
  },
  lastLoginAt: lastLoginAtDate,
  now: nowDate,
  elapsedHours: (nowDate.getTime() - lastLoginAtDate.getTime()) / (1000 * 60 * 60),
};

// -------------------------------------------------------
// 実行
// -------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log(`[test-runner] process: ${processName}`);
  console.log(`[test-runner] characterId: ${req.characterId}`);
  console.log(`[test-runner] elapsed: ${req.elapsedHours.toFixed(1)}h`);
  console.log(`[test-runner] message: "${req.message}"`);
  console.log("=".repeat(60));

  switch (processName) {
    case "eventResolver": {
      const result = await runEventResolver(req);
      console.log("\n[RESULT] eventResolver:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "actionPlanner": {
      console.log("[test-runner] running eventResolver first...");
      const eventResult = await runEventResolver(req);
      console.log("[test-runner] eventResolver done, running actionPlanner...");
      const result = await runActionPlanner(req, eventResult);
      console.log("\n[RESULT] actionPlanner:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "emotionUpdater": {
      const proc = parseInt(values.process!, 10) as 1 | 2;
      if (proc === 1) {
        console.log("[test-runner] running eventResolver + actionPlanner first...");
        const eventResult = await runEventResolver(req);
        const actionResult = await runActionPlanner(req, eventResult);
        const result = await runEmotionUpdater({
          req,
          process: 1,
          events: eventResult.events,
          actions: actionResult.actions,
        });
        console.log("\n[RESULT] emotionUpdater (process1):");
        console.log(JSON.stringify(result, null, 2));
      } else {
        const msg = values.message || "今日は調子どう？";
        const result = await runEmotionUpdater({
          req: { ...req, message: msg },
          process: 2,
          playerMessage: msg,
        });
        console.log("\n[RESULT] emotionUpdater (process2):");
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }

    case "memoryRetriever": {
      const proc = parseInt(values.process!, 10) as 1 | 2;
      if (proc === 1) {
        console.log("[test-runner] running eventResolver + actionPlanner first...");
        const eventResult = await runEventResolver(req);
        const actionResult = await runActionPlanner(req, eventResult);
        await runMemoryRetriever({
          req,
          process: 1,
          events: eventResult.events,
          actions: actionResult.actions,
        });
        console.log("\n[RESULT] memoryRetriever (process1): done (check DynamoDB)");
      } else {
        await runMemoryRetriever({ req, process: 2 });
        console.log("\n[RESULT] memoryRetriever (process2): done (check DynamoDB)");
      }
      break;
    }

    case "dialogueGenerator": {
      const longTimeFlag = parseInt(values.longTimeFlag!, 10) as 0 | 1;
      const result = await runDialogueGenerator({
        req,
        mood: undefined,
        perception: undefined,
        events: [],
        actions: [],
        longTimeFlag,
      });
      console.log("\n[RESULT] dialogueGenerator:");
      console.log(result);
      break;
    }

    case "all": {
      console.log("\n--- [1/5] eventResolver ---");
      const eventResult = await runEventResolver(req);
      console.log(JSON.stringify(eventResult, null, 2));

      console.log("\n--- [2/5] actionPlanner ---");
      const actionResult = await runActionPlanner(req, eventResult);
      console.log(JSON.stringify(actionResult, null, 2));

      console.log("\n--- [3/5] emotionUpdater ---");
      const { mood, perception } = await runEmotionUpdater({
        req,
        process: 1,
        events: eventResult.events,
        actions: actionResult.actions,
      });
      console.log(JSON.stringify({ mood, perception }, null, 2));

      console.log("\n--- [4/5] memoryRetriever ---");
      await runMemoryRetriever({
        req,
        process: 1,
        events: eventResult.events,
        actions: actionResult.actions,
      });
      console.log("done");

      console.log("\n--- [5/5] dialogueGenerator ---");
      const longTimeFlag = parseInt(values.longTimeFlag!, 10) as 0 | 1;
      const reply = await runDialogueGenerator({
        req,
        mood,
        perception,
        events: eventResult.events,
        actions: actionResult.actions,
        longTimeFlag,
      });
      console.log(reply);

      console.log("\n" + "=".repeat(60));
      console.log("[FINAL RESPONSE]");
      console.log(JSON.stringify({ characterId: req.characterId, reply, mood, perception }, null, 2));
      break;
    }

    default:
      console.error(`Unknown process: ${processName}`);
      console.error("Available: eventResolver, actionPlanner, emotionUpdater, memoryRetriever, dialogueGenerator, all");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
