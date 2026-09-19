/**
 * 関係値（perception）の伸び方の試算 CLI（D-040 フェーズ15）
 *
 * lib/affect/perceptionGrowthSimulation.ts を、パッケージ（content/packages/*.json）を
 * 読み込んで実行する薄い CLI。LLM も DynamoDB も呼ばない（AWS は使わない）。
 *
 * 使い方:
 *   npx tsx scripts/simulate-perception-growth.ts [options]
 *
 * オプション:
 *   --package <id>              試算するパッケージ（既定: yui-modern-tokyo）
 *   --sessions-per-day <n>      1日あたりのセッション数（既定: 1）
 *   --messages-per-session <n>  1セッションあたりのメッセージ数（履歴の条件の判定に使う。既定: 10）
 *   --gain-scale <n>            affectConfig.perception.gainScale の上書き（既定: 設定値どおり）
 *   --sigma <n>                 affectConfig.perception.dampingSigma の上書き（既定: 設定値どおり）
 *   --max-days <n>              打ち切り日数（既定: 365）
 *   --help / -h
 *
 * 例:
 *   npx tsx scripts/simulate-perception-growth.ts
 *   npx tsx scripts/simulate-perception-growth.ts --package <packageId>
 *   npx tsx scripts/simulate-perception-growth.ts --gain-scale 0.6 --sigma 0.5
 *
 * 1セッションで確定する差分は「ふつうに楽しく話した日」の想定値で固定する
 * （trust:1.0 affection:1.4 respect:0.5 dependence:0.4 familiarity:2.2。
 * 作業用/simulate-perception.ts の試算と同じ値）。
 */

import { fileURLToPath } from "url";
import { parseArgs } from "util";

// packages.ts が content/ を読み込む際の探索先（未設定なら api/content/ を向ける）
process.env.CONTENT_DIR ??= fileURLToPath(new URL("../content", import.meta.url));

import { loadPackage, DEFAULT_PACKAGE_ID } from "../src/lib/packages.js";
import { simulatePerceptionGrowth } from "../src/lib/affect/perceptionGrowthSimulation.js";
import { DEFAULT_AFFECT_CONFIG } from "../src/lib/affect/affectConfig.js";
import type { AffectConfig } from "../src/lib/affect/affectConfig.js";
import type { Perception, PerceptionContribution } from "../src/types.js";

// 1セッションで確定する差分の想定（ピーク・エンドの平均）。ふつうに楽しく話した日
const SESSION_DELTA: PerceptionContribution = {
  trust: 1.0,
  affection: 1.4,
  respect: 0.5,
  dependence: 0.4,
  familiarity: 2.2,
};

const { values } = parseArgs({
  options: {
    package: { type: "string", default: DEFAULT_PACKAGE_ID },
    "sessions-per-day": { type: "string", default: "1" },
    "messages-per-session": { type: "string", default: "10" },
    "gain-scale": { type: "string" },
    sigma: { type: "string" },
    "max-days": { type: "string", default: "365" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: npx tsx scripts/simulate-perception-growth.ts [options]

Options:
  --package <id>              試算するパッケージ（既定: ${DEFAULT_PACKAGE_ID}）
  --sessions-per-day <n>      1日あたりのセッション数（既定: 1）
  --messages-per-session <n>  1セッションあたりのメッセージ数（既定: 10）
  --gain-scale <n>            perception.gainScale の上書き（既定: ${DEFAULT_AFFECT_CONFIG.perception.gainScale}）
  --sigma <n>                 perception.dampingSigma の上書き（既定: ${DEFAULT_AFFECT_CONFIG.perception.dampingSigma}）
  --max-days <n>              打ち切り日数（既定: 365）
  --help, -h                  このヘルプを表示
`);
  process.exit(0);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPerception(perception: Perception): string {
  return (Object.entries(perception) as Array<[string, number]>).map(([key, value]) => `${key}:${round(value)}`).join(" ");
}

async function main(): Promise<void> {
  const packageId = values.package as string;
  const pkg = await loadPackage(packageId);
  if (!pkg) {
    console.error(`パッケージが見つかりません: ${packageId}`);
    process.exit(1);
  }

  const config: AffectConfig = {
    ...DEFAULT_AFFECT_CONFIG,
    perception: {
      ...DEFAULT_AFFECT_CONFIG.perception,
      gainScale:
        values["gain-scale"] !== undefined ? Number(values["gain-scale"]) : DEFAULT_AFFECT_CONFIG.perception.gainScale,
      dampingSigma: values.sigma !== undefined ? Number(values.sigma) : DEFAULT_AFFECT_CONFIG.perception.dampingSigma,
    },
  };

  const sessionsPerDay = Number(values["sessions-per-day"]);
  const messagesPerSession = Number(values["messages-per-session"]);
  const maxDays = Number(values["max-days"]);

  const results = simulatePerceptionGrowth(
    {
      character: pkg.character,
      sessionDelta: SESSION_DELTA,
      sessionsPerDay,
      messagesPerSession,
      maxDays,
    },
    config
  );

  console.log(
    `パッケージ: ${pkg.id}（${pkg.character.name}） gainScale=${config.perception.gainScale} sigma=${config.perception.dampingSigma} sessionsPerDay=${sessionsPerDay} messagesPerSession=${messagesPerSession} maxDays=${maxDays}`
  );
  console.log("");

  for (const result of results) {
    console.log(
      `${result.stageLabel}（${result.stageKey}）: 入った日=${result.enteredOnDay} ` +
        `関係値条件を満たす=${result.perceptionConditionMetOnDay ?? "-"}日目 ` +
        `履歴条件を満たす=${result.historyConditionMetOnDay ?? "-"}日目 ` +
        `次の段階へ=${result.promotedOnDay ?? "-"}日目`
    );
    console.log(`   終了時の関係値: ${formatPerception(result.perceptionAtEnd)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
