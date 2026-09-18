# api/test/unit/handlers

`src/handlers/` の単体テスト。対象の概要は [`../../../src/handlers/README.md`](../../../src/handlers/README.md) を参照。契約の正は [`../../../README.md`](../../../README.md) の「API 仕様」。

## 対象と方針

5本のハンドラーはいずれも「`parseRequestBody` → 入力チェック → `loadRequestedPackage` → `run*` 用の引数へ詰め替え → `run*` 呼び出し → `createResponse`」という同じ形をしているため、確認する観点も共通にしている。

- `run*`（`../../../src/eventResolver/index.js` の `runEventResolver` など）は `vi.mock()` でモジュールごと差し替え、テストごとに `vi.mocked(runX).mockResolvedValue(...)` で戻り値を設定する。`vitest.config.ts` の `restoreMocks: true` により `mockResolvedValue` 等の設定はテストごとにクリアされるため、各テストファイルの `beforeEach` で既定の成功値を設定し、異常系のテストだけ個別に上書きしている。
- `lib/packages.js` はスタブにせず、`CONTENT_DIR`（`vitest.config.ts` の `test.env`）経由で本物の `api/content/`（既定パッケージ `yui-modern-tokyo`）を読む。
- `lib/utils.js` もスタブにしない。
- `run*` をモジュールごとモックしているため、その先で import される `lib/bedrock.js` / `lib/dynamo.js` は評価されず、AWS への呼び出しは発生しない。
- イベントは API Gateway 形式 `{ body: JSON.stringify({...}) }` を基本にする。レスポンスは `statusCode` と `JSON.parse(body)` で確認する。
- `now` / `lastLoginAt` を省略したときにサーバー現在時刻が使われることの確認は `vi.useFakeTimers()` + `vi.setSystemTime()` で現在時刻を固定して行う。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `eventResolver.test.ts` | `src/handlers/eventResolver.ts` | `characterId` 未指定・`lastLoginAt`/`now` の日時フォーマット不正・不明な `packageId`（存在しない ID／形式不正）で 400、`packageId` 省略時の既定パッケージの受け渡し、`lastLoginAt` 省略時は `now` と同値、両方が ISO8601 文字列に正規化されて渡ること、`now` 省略時はサーバー現在時刻、成功時は `runEventResolver` の結果がそのまま 200 の body になること、例外時は 500 で `errorName`/`errorMessage` |
| `actionPlanner.test.ts` | `src/handlers/actionPlanner.ts` | 上記と同じ日時・`packageId` の入力チェック、`events` が配列ならそのまま／配列でなければ空配列で渡ること、200/500 のレスポンス形 |
| `emotionUpdater.test.ts` | `src/handlers/emotionUpdater.ts` | `characterId` 未指定・`process` が 1/2 以外（未指定・3・文字列 `"1"`）で 400、process1 での `events`/`actions` の受け渡し（配列でなければ空配列）、process2 での `playerMessage`（省略時は空文字）、成功時 body は `{ mood, perception }` |
| `memoryRetriever.test.ts` | `src/handlers/memoryRetriever.ts` | `characterId`/`process` の入力チェックは同上、process1 での `events`/`actions` の受け渡し、process2 では `events`/`actions` を渡さないこと、成功時 body は常に `{ ok: true }`（`runMemoryRetriever` の戻り値は使わない） |
| `dialogueGenerator.test.ts` | `src/handlers/dialogueGenerator.ts` | `characterId` 未指定・`now` の日時フォーマット不正・不明な `packageId` で 400、`message` 省略時は空文字、`mood`/`perception` 省略時は `undefined` のまま渡る（DynamoDB 参照は `run*` 側の責務のため未検証）、`events`/`actions` は配列なら渡り配列でなければ `undefined`、`longTimeFlag` の受け渡し、成功時 body は `{ reply }` |

## 契約とのずれ・気づいたこと（`src/` は未修正）

いずれも「実装した機能に対応する」テストではなく、既存実装の現状の挙動をそのまま確認したもの。`src/` の修正は本フェーズの対象外のため行っていない。詳細は作業報告（呼び出し元へのハンドバック）を参照。

- **body が JSON として壊れている場合、400 ではなく 500 になる**（`eventResolver.test.ts` の「契約とのずれの確認」で確認）。`parseRequestBody`（`src/lib/utils.ts`）内の `JSON.parse` が例外を投げ、ハンドラーの `catch` が拾って 500 にする。`api/README.md` の「エラーレスポンス」節は 400 の条件に `characterId` 未指定 / `process` 不正 / 日時フォーマット不正のみを挙げており、壊れたリクエストボディは明記されていない。
- **`characterId` が文字列以外（例: 数値）でも、truthy であれば型チェックされずに通る**（`eventResolver.test.ts` で確認）。`characterId` の必須チェックは `!characterId` の真偽判定のみで、型は見ていない。`api/README.md` は `characterId` の型を `string` としている。
