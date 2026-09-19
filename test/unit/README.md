# api/test/unit

Vitest で実行する単体テストコード。テストの考え方・方針はルートの [`test/test_unit/README.md`](../../../test/test_unit/README.md) を参照（着手前に必読）。

## 配置

`src/` と同じフォルダ構成にする。例: `src/lib/utils.ts` のテストは `test/unit/lib/utils.test.ts`。

| フォルダ | 対応する `src/`（または `infra/`・`scripts/`） | 内容 |
|---|---|---|
| [`lib/`](lib/README.md) | `src/lib/` | `bedrock.ts` / `dynamo.ts` / `packages.ts` / `utils.ts` / `timezone.ts` / `random.ts` / `absenceRecordText.ts` / `characterStateText.ts` / `apiHandler.ts` / `relationship.ts` / `relationshipText.ts` / `testerId.ts` などの単体テスト |
| [`promptPartials/`](promptPartials/README.md) | `src/promptPartials/` | 共有パーシャル（`world.mustache` / `speechExamples.mustache`）と `buildPromptContext` の単体テスト |
| [`absenceSimulator/`](absenceSimulator/README.md) | `src/absenceSimulator/` | 不在期間のシミュレーション（骨格の生成、プロンプトの組み立て、LLM の出力の突き合わせ、本体 `runAbsenceSimulator`）の単体テスト |
| [`handlers/`](handlers/README.md) | `src/handlers/` | `absenceSimulator` / `emotionUpdater` / `memoryRetriever` / `dialogueGenerator` の4ハンドラーの単体テスト（`run*` はスタブ） |
| [`emotionUpdater/`](emotionUpdater/README.md) | `src/emotionUpdater/` | `runEmotionUpdater` とプロンプトの層の組み立て（`prompt.ts`）の単体テスト（Bedrock / DynamoDB はスタブ） |
| [`memoryRetriever/`](memoryRetriever/README.md) | `src/memoryRetriever/` | `runMemoryRetriever` とプロンプトの層の組み立て（`prompt.ts`）の単体テスト（Bedrock / DynamoDB はスタブ） |
| [`dialogueGenerator/`](dialogueGenerator/README.md) | `src/dialogueGenerator/` | `runDialogueGenerator` とプロンプトの層の組み立て（`prompt.ts`）の単体テスト（Bedrock / DynamoDB はスタブ） |
| [`testerCharacters/`](testerCharacters/README.md) | `src/testerCharacters/` | `runListTesterCharacters`/`runCreateTesterCharacter` の単体テスト（DynamoDB はスタブ、`packages.js` は本物） |
| [`infra/`](infra/README.md) | `infra/functions/` | API 専用 CloudFront の viewer request で動く CloudFront Function（`api-auth.js`）の単体テスト。実行環境が無いため、ファイルを文字列として読み `new Function` で評価する |
| [`scripts/`](scripts/README.md) | `scripts/manage-testers.ts` | テスター登録スクリプトの純粋な関数（`validateTesterId` / `validatePassword` / `createStoredValue` / `parseArgs`）の単体テストと、その値が `infra/functions/api-auth.js`（`test/unit/infra/loadApiAuthHandler.ts` 経由）で実際に通ることの確認。AWS CLI を呼ぶ部分（`execFile`）はテストしない |

## 実行

`api/` 配下で以下を実行する。

```bash
npm test          # vitest run（1回実行。CI もこれを実行する）
npm run test:watch   # vitest（ウォッチモード）
```

CI（[`../../.github/workflows/deploy-stg.yml`](../../.github/workflows/deploy-stg.yml)）は `develop` ブランチへの push 時、型チェックの直後・ビルドの前に `npm test` を実行し、デプロイ前のゲートになっている（失敗するとビルド・`cdk deploy` は実行されない）。2026-09-19 時点で 47 ファイル・871 件成功 ＋ todo 1 件（`memoryRetriever`）。

## `.mustache` の扱い

`src/*/prompts/*.mustache` や `src/promptPartials/*.mustache` は esbuild の `--loader:.mustache=text` によって文字列としてバンドルされる（`src/mustache.d.ts` のアンビエントモジュール宣言）。Vitest では同じ挙動を [`../../vitest.config.ts`](../../vitest.config.ts) のインラインプラグイン（`enforce: "pre"` の `transform` フックで `.mustache` を `export default <文字列>` に変換）で再現している。`promptPartials/index.test.ts` はこのプラグインが機能していることの確認を兼ねる。

## スタブ方針

ルートの [`test/test_unit/README.md`](../../../test/test_unit/README.md) の「方針」節を参照。要点:

- Bedrock / DynamoDB は呼ばず、`vi.spyOn` や `vi.mock()` でスタブに置き換える（`aws-sdk-client-mock` 等の追加パッケージは使わない）。
- `packages.ts` の読み込みはスタブにせず、`CONTENT_DIR`（`vitest.config.ts` の `test.env` で `api/content/` を指す）から本物の JSON を読む。
- export されていない関数（`extractTableName` 等）は公開関数を通して確かめる。テストのためだけの export 追加はしない。
- `globals` は使わない。`describe` / `it` / `expect` / `vi` はテストファイルごとに `vitest` から明示的に import する。
- `test.restoreMocks: true` により、モックはテストごとに自動で元に戻る。
