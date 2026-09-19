# api/infra

`api/` の AWS インフラの CDK 定義（独立した npm パッケージ）。全体像は [`../README.md`](../README.md)、コマンドは [`CLAUDE.md`](../../CLAUDE.md) の「コマンド」節を参照。

| パス | 内容 |
|---|---|
| `bin/infra.ts` | CDK アプリのエントリーポイント（`VtuberSimulatorStack`・`GithubOidcStack`） |
| `lib/vtuber-simulator-stack.ts` | アプリ本体のスタック（Lambda・API Gateway・DynamoDB・API の入口） |
| `lib/api-entrance.ts` | API 専用の CloudFront（資格情報の検証・API キーの付与・CORS） |
| `lib/github-oidc-stack.ts` | GitHub Actions の stg デプロイ用のロール（`vtuber-simulator-api` 用と `vtuber-simulator-front-web` 用の2つ。D-036・D-039。手動デプロイ専用） |
| `functions/` | CloudFront Function（[`functions/README.md`](functions/README.md)） |
| `test/` | CDK のテスト（`npm test`。`aws-cdk-lib/assertions`。CI ではまだ実行していない。F-033） |
| `test/package-catalog.test.ts` | パッケージ（キャラクター×世界観）一覧 Lambda（`GET /packages`）のテスト（`test/tester-characters.test.ts`と同じ書き方。関数名・ハンドラー・環境変数・DynamoDB/Bedrock の権限が無いこと・`GET` のみ・出力を確認） |
| `cdk.json` | CDK の設定と、ステージごとのコンテキスト（下記） |

## `cdk.json` のコンテキスト（ステージごと）

| キー | 内容 |
|---|---|
| `corsAllowedOrigins` | API の入口で CORS を許可するオリジン（D-025・D-027） |
| `apiKeyVersion` | API キーの版番号。上げると作り直す（`../README.md` の「アクセス制限」） |
| `enforceCharacterOwnership` | `true` なら、4つのエンドポイントと `/debug-character-state` でキャラクターの持ち主を確かめる |
| `enableDebugEndpoints` | `true` のステージにだけ、デバッグ専用の `POST /debug-character-state` の Lambda と API のリソースを作る（stg のみ。D-038） |
