# api/test/unit/eventResolver

`src/eventResolver/` の単体テスト。対象の概要は [`../../../src/eventResolver/README.md`](../../../src/eventResolver/README.md) を参照。

## 対象と方針

`runEventResolver` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）と `../../../src/lib/dynamo.js`（`getRelevantMemories`・`saveEvent`）を `vi.mock()` でモジュールごと差し替え、`beforeEach` で既定の戻り値を設定している。`invokeModelJson` の既定実装は「渡された第3引数（fallback）をそのまま返す」もので、実際の `invokeModelJson` がフォールバックした場合と同じ状態を再現する。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/eventResolver/index.ts` | `elapsed` の文字列（時間+分／分が0のときは時間のみ）、`startDatetime`/`endDatetime` の ISO8601 正規化、`getRelevantMemories` がクエリ指定なしで呼ばれること、記憶の有無によるプロンプトの内容（「（なし）」を含む）、モデル応答の `events` の反映、fallback時・`events` 欠落時の `events: []`、UUID の形式、`saveEvent` への保存内容（`event_id` が返り値の UUID と一致すること含む） |

## 見つかった疑わしい挙動（`src/` は未修正）

- **`now` が `lastLoginAt` より前のとき、`elapsed` が負の文字列になる**（例: `-2時間`）。入力チェックが無いため計算がそのまま行われる。`elapsedHours`/`elapsedMinutes` は `Math.floor` を負の値に適用した結果で、直感的な絶対値表示にはならない。詳細は作業報告（呼び出し元へのハンドバック）を参照。「現状の挙動の確認」の `describe` に確認用のテストを残している。
