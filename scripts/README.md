# scripts

開発・運用用のスクリプト（`api/` 配下で実行）。

| ファイル | 内容 |
|---|---|
| `copy-content.mjs` | `content/` を `dist/content/` にコピーする（README は除く）。`npm run build`（`build:content`）から実行される |
| `test-runner.ts` | 各機能の `run*` を実際の AWS（Bedrock＋stg の DynamoDB）に対して直接呼ぶ CLI。`--package <id>` でパッケージを指定する。`npx tsx scripts/test-runner.ts --help` |
| `clear-tables.mjs` | stg の DynamoDB テーブルを全削除する。会話ログも含めて消えるため注意 |

## 注意

- `test-runner.ts` は `npx tsx` で `.mustache` のインポートに失敗する既知の問題がある（`.notes/_followup.md` の F-006 参照）。
- `test-runner.ts` は `tsconfig.json` の対象外（`include` は `src/**/*` のみ）のため、`npx tsc --noEmit` では型チェックされない。
