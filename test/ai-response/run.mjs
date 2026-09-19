#!/usr/bin/env node
// -------------------------------------------------------
// AI 応答テストの起動スクリプト。
//
// runner/cli.ts を esbuild の API でバンドルしてから（.mustache のインポートのため。
// F-006 と同じ理由）、そのファイルを node で実行する。引数はそのまま cli.ts に渡す。
//
// 使い方（api/ 配下で実行。package.json の "test:ai" スクリプトが呼び出す）:
//   node test/ai-response/run.mjs -- --dry-run
//   npm run test:ai -- --dry-run
//   npm run test:ai -- --models nova-lite,claude-haiku-4-5 --repeat 2
// -------------------------------------------------------

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "runner", "cli.ts");
const outfile = path.join(here, ".build", "cli.mjs");

async function main() {
  console.error("[run.mjs] バンドル中...");
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".mustache": "text" },
    external: ["@aws-sdk/*"],
    logLevel: "info",
  });

  console.error("[run.mjs] 実行中...");
  const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

main().catch((e) => {
  console.error("[run.mjs] failed:", e);
  process.exitCode = 1;
});
