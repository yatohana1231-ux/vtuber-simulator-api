# api/test/unit/handlers

`src/handlers/` の単体テスト。対象の概要は [`../../../src/handlers/README.md`](../../../src/handlers/README.md) を参照。契約の正は [`../../../README.md`](../../../README.md) の「API 仕様」。

## 対象と方針

4本のハンドラーはいずれも「`parseRequestBody` → 入力チェック → `loadRequestedPackage` → `run*` 用の引数へ詰め替え → `run*` 呼び出し → `createResponse`」という同じ形をしているため、確認する観点も共通にしている。2026-09-19 にこの共通の処理を `src/lib/apiHandler.ts` にまとめた（A-9）。このフォルダのテストは書き換えずに通しており、振る舞いが変わっていないことの確認を兼ねる。`apiHandler.ts` 自体のテストは [`../lib/README.md`](../lib/README.md) を参照。

- `run*`（`../../../src/absenceSimulator/index.js` の `runAbsenceSimulator` など）は `vi.mock()` でモジュールごと差し替え、テストごとに `vi.mocked(runX).mockResolvedValue(...)` で戻り値を設定する。`vitest.config.ts` の `restoreMocks: true` により `mockResolvedValue` 等の設定はテストごとにクリアされるため、各テストファイルの `beforeEach` で既定の成功値を設定し、異常系のテストだけ個別に上書きしている。
- `lib/packages.js` はスタブにせず、`CONTENT_DIR`（`vitest.config.ts` の `test.env`）経由で本物の `api/content/`（既定パッケージ `yui-modern-tokyo`）を読む。
- `lib/utils.js` もスタブにしない。
- `run*` をモジュールごとモックしているため、その先で import される `lib/bedrock.js` / `lib/dynamo.js` は評価されず、AWS への呼び出しは発生しない。
- イベントは API Gateway 形式 `{ body: JSON.stringify({...}) }` を基本にする。レスポンスは `statusCode` と `JSON.parse(body)` で確認する。
- `now` / `lastLoginAt` を省略したときにサーバー現在時刻が使われることの確認は `vi.useFakeTimers()` + `vi.setSystemTime()` で現在時刻を固定して行う。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `absenceSimulator.test.ts` | `src/handlers/absenceSimulator.ts` | `characterId` 未指定・`lastLoginAt`/`now` の日時フォーマット不正・不明な `packageId`（存在しない ID／形式不正）で 400、`packageId` 省略時の既定パッケージの受け渡し、`lastLoginAt` 省略時は `now` と同値、両方が ISO8601 文字列に正規化されて渡ること、`now` 省略時はサーバー現在時刻、成功時は `runAbsenceSimulator` の結果がそのまま 200 の body になること、例外時は 500 で `errorName`/`errorMessage`。加えて、`now` が `lastLoginAt` より前なら 400（同時刻は 200）、`lastLoginAt` だけ指定して `now` 省略時に `lastLoginAt` が未来なら 400、`run*` に既定パッケージの `lifestyle` と `timezone` を持つ `world` が渡ること |
| `emotionUpdater.test.ts` | `src/handlers/emotionUpdater.ts` | `characterId` 未指定・`process` が 1/2 以外（未指定・3・文字列 `"1"`）で 400、process1 では `events`/`actions` が送られても `run*` に渡らないこと（記録は DB から読む。D-022）、process2 での `playerMessage`（省略時は空文字）、成功時 body は `{ mood, perception }` |
| `memoryRetriever.test.ts` | `src/handlers/memoryRetriever.ts` | `characterId`/`process` の入力チェックは同上、process1・process2 とも `events`/`actions` が送られても `run*` に渡らないこと、成功時 body は常に `{ ok: true }`（`runMemoryRetriever` の戻り値は使わない） |
| `dialogueGenerator.test.ts` | `src/handlers/dialogueGenerator.ts` | `characterId` 未指定・`now` の日時フォーマット不正・不明な `packageId` で 400、`message` 省略時は空文字、`mood`/`perception` 省略時は `undefined` のまま渡る（DynamoDB 参照は `run*` 側の責務のため未検証）、`events`/`actions` は送られても `run*` に渡らないこと、`longTimeFlag` の受け渡し、成功時 body は `{ reply }` |

## 入力チェック（F-018）

以前は「契約とのずれ」として、壊れた JSON の body が 500 になること、文字列以外の `characterId` が通ることを現状の挙動のまま確かめていた。2026-09-19 に [F-018](../../../../.notes/followup/F-018.md) を直し（`src/lib/apiHandler.ts`）、期待する挙動を確かめるテストに書き換えた。

- `absenceSimulator.test.ts` の「入力チェック（F-018）」と、ほかの3本のテストで、壊れた JSON の body と数値の `characterId` が 400 になり、`run*` が呼ばれないことを確かめる。
- `characterId` のエラーメッセージは、未指定・文字列以外・空文字のどれでも `characterId must be a non-empty string`。
- オブジェクトでない JSON の body（`null`・配列など）の扱いは、共通処理のテスト（`../lib/apiHandler.test.ts`）で確かめる。
