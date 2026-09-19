/**
 * 各処理の単体テスト CLI
 *
 * 使い方:
 *   npx tsx scripts/test-runner.ts <process> [options]
 *
 * プロセス:
 *   absenceSimulator   - 不在期間のシミュレーション（出来事・行動・続きの話題の生成）
 *   emotionUpdater     - 感情更新（プロセス1 or 2）。プロセス1は DynamoDB の最新の不在期間の記録を読む
 *                        （D-022）。単独ステージで実行したとき、記録が無ければ何もしない（LLM を呼ばず
 *                        現在の状態を返す。事前に absenceSimulator ステージを実行しておくこと）
 *   memoryRetriever    - 重要記憶判定（プロセス1 or 2）。プロセス1は DynamoDB の最新の不在期間の記録を読む
 *                        （D-022）。単独ステージで実行したとき、記録が無ければ何もしない
 *   dialogueGenerator  - 会話生成
 *   all                - プロセス1相当の全パイプライン
 *                        （absenceSimulator→emotionUpdater→memoryRetriever→dialogueGenerator）
 *                        ※エンドポイント分割後、この呼び出し順序を決めるのはフロント側の責務になる。
 *                          後段の3機能は DB に保存された最新の不在期間の記録を読むので、
 *                          absenceSimulator → 後段の順に呼ぶだけでよい（events/actions の中継は不要）。
 *
 * 環境変数（.env or 直接指定）:
 *   BEDROCK_MODEL_ID, CHARACTER_MEMORY_TABLE, CONVERSATION_LOGS_TABLE, EVENTS_TABLE, AWS_REGION,
 *   CONTENT_DIR（パッケージの読み込み先。既定は api/content/）
 *
 * 例:
 *   npx tsx scripts/test-runner.ts absenceSimulator
 *   npx tsx scripts/test-runner.ts emotionUpdater --process 2 --message "今日は調子どう？"
 *   npx tsx scripts/test-runner.ts dialogueGenerator --longTimeFlag 1
 *   npx tsx scripts/test-runner.ts dialogueGenerator --package yui-modern-tokyo --message "配信見たよ"
 *   npx tsx scripts/test-runner.ts all
 */

import { fileURLToPath } from "url";
import { parseArgs } from "util";

// 環境変数のデフォルト（stg 環境）
process.env.AWS_REGION ??= "ap-northeast-1";
process.env.BEDROCK_MODEL_ID ??= "apac.amazon.nova-lite-v1:0";
process.env.CHARACTER_MEMORY_TABLE ??= "v-simu-characters-memory-stg";
process.env.CONVERSATION_LOGS_TABLE ??= "vtuber-simu-conversation-log-stg";
process.env.EVENTS_TABLE ??= "v-simu-events-stg";
process.env.CONTENT_DIR ??= fileURLToPath(new URL("../content", import.meta.url));

import { runAbsenceSimulator } from "../src/absenceSimulator/index.js";
import { runEmotionUpdater } from "../src/emotionUpdater/index.js";
import { runMemoryRetriever } from "../src/memoryRetriever/index.js";
import { runDialogueGenerator } from "../src/dialogueGenerator/index.js";
import { DEFAULT_PACKAGE_ID, loadPackage } from "../src/lib/packages.js";
import type { AbsenceSimulatorRequest } from "../src/types.js";

// -------------------------------------------------------
// CLI 引数パース
// -------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    characterId: { type: "string", default: "d89c3b4f-9e27-4f5a-b8d1-7c4e2a91f6b3" },
    package: { type: "string", default: DEFAULT_PACKAGE_ID },
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
  absenceSimulator   不在期間のシミュレーション（出来事・行動・続きの話題の生成）
  emotionUpdater     感情更新。プロセス1は DynamoDB の最新の不在期間の記録を読む（無ければ何もしない。
                     先に absenceSimulator ステージを実行しておくこと）
  memoryRetriever    重要記憶判定。プロセス1は DynamoDB の最新の不在期間の記録を読む（無ければ何もしない）
  dialogueGenerator  会話生成
  all                プロセス1相当の全パイプライン（フロント側オーケストレーションの再現）

Options:
  --characterId <id>       キャラクターID (default: テスト用UUID)
  --package <id>           キャラクター×世界観パッケージのID (default: ${DEFAULT_PACKAGE_ID})
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
// 共通データ組み立て
// -------------------------------------------------------

const nowDate = values.now ? new Date(values.now) : new Date();
const lastLoginAtDate = values.lastLoginAt
  ? new Date(values.lastLoginAt)
  : new Date(nowDate.getTime() - 6 * 60 * 60 * 1000); // デフォルト6時間前

const characterId = values.characterId!;
const pkg = await loadPackage(values.package!);
if (!pkg) {
  console.error(`Unknown package: ${values.package}`);
  process.exit(1);
}
const { world, character, lifestyle } = pkg;
const nowIso = nowDate.toISOString();
const lastLoginAtIso = lastLoginAtDate.toISOString();
const elapsedHours = (nowDate.getTime() - lastLoginAtDate.getTime()) / (1000 * 60 * 60);

function buildAbsenceSimulatorRequest(): AbsenceSimulatorRequest {
  return {
    characterId,
    world,
    character,
    lifestyle,
    lastLoginAt: lastLoginAtIso,
    now: nowIso,
  };
}

// -------------------------------------------------------
// 実行
// -------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log(`[test-runner] process: ${processName}`);
  console.log(`[test-runner] characterId: ${characterId}`);
  console.log(`[test-runner] package: ${values.package}`);
  console.log(`[test-runner] elapsed: ${elapsedHours.toFixed(1)}h`);
  console.log(`[test-runner] message: "${values.message}"`);
  console.log("=".repeat(60));

  switch (processName) {
    case "absenceSimulator": {
      const result = await runAbsenceSimulator(buildAbsenceSimulatorRequest());
      console.log("\n[RESULT] absenceSimulator:");
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "emotionUpdater": {
      const proc = parseInt(values.process!, 10) as 1 | 2;
      if (proc === 1) {
        console.log(
          "[test-runner] process1 reads the latest absence record from DynamoDB. " +
            "If none exists for this characterId, run the absenceSimulator stage first " +
            "(it will do nothing here otherwise)."
        );
        const result = await runEmotionUpdater({
          characterId,
          world,
          character,
          process: 1,
        });
        console.log("\n[RESULT] emotionUpdater (process1):");
        console.log(JSON.stringify(result, null, 2));
      } else {
        const msg = values.message || "今日は調子どう？";
        const result = await runEmotionUpdater({
          characterId,
          world,
          character,
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
        console.log(
          "[test-runner] process1 reads the latest absence record from DynamoDB. " +
            "If none exists for this characterId, run the absenceSimulator stage first " +
            "(it will do nothing here otherwise)."
        );
        await runMemoryRetriever({
          characterId,
          world,
          character,
          process: 1,
        });
        console.log("\n[RESULT] memoryRetriever (process1): done (check DynamoDB)");
      } else {
        await runMemoryRetriever({ characterId, world, character, process: 2 });
        console.log("\n[RESULT] memoryRetriever (process2): done (check DynamoDB)");
      }
      break;
    }

    case "dialogueGenerator": {
      const longTimeFlag = parseInt(values.longTimeFlag!, 10) as 0 | 1;
      const result = await runDialogueGenerator({
        characterId,
        world,
        character,
        now: nowIso,
        message: values.message!,
        longTimeFlag,
      });
      console.log("\n[RESULT] dialogueGenerator:");
      console.log(result);
      break;
    }

    case "all": {
      console.log("\n--- [1/4] absenceSimulator ---");
      const absenceResult = await runAbsenceSimulator(buildAbsenceSimulatorRequest());
      console.log(JSON.stringify(absenceResult, null, 2));

      // absenceSimulator が保存した最新の記録を、後段の3機能が DynamoDB から読む（D-022）。
      // events/actions をここで中継する必要はない。
      console.log("\n--- [2/4] emotionUpdater ---");
      const { mood, perception } = await runEmotionUpdater({
        characterId,
        world,
        character,
        process: 1,
      });
      console.log(JSON.stringify({ mood, perception }, null, 2));

      console.log("\n--- [3/4] memoryRetriever ---");
      await runMemoryRetriever({
        characterId,
        world,
        character,
        process: 1,
      });
      console.log("done");

      console.log("\n--- [4/4] dialogueGenerator ---");
      // mood/perceptionはここでは渡さない（D-032）。emotionUpdaterが保存した値を
      // runDialogueGeneratorがDynamoDBから読むので、結果はmood/perceptionを渡していたときと同じ。
      const longTimeFlag = parseInt(values.longTimeFlag!, 10) as 0 | 1;
      const reply = await runDialogueGenerator({
        characterId,
        world,
        character,
        now: nowIso,
        message: values.message!,
        longTimeFlag,
      });
      console.log(reply);

      console.log("\n" + "=".repeat(60));
      console.log("[FINAL RESPONSE]");
      console.log(JSON.stringify({ characterId, reply, mood, perception }, null, 2));
      break;
    }

    default:
      console.error(`Unknown process: ${processName}`);
      console.error("Available: absenceSimulator, emotionUpdater, memoryRetriever, dialogueGenerator, all");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
