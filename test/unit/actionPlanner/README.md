# api/test/unit/actionPlanner

`src/actionPlanner/` の単体テスト。対象の概要は [`../../../src/actionPlanner/README.md`](../../../src/actionPlanner/README.md) を参照。

## 対象と方針

`runActionPlanner` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）と `../../../src/lib/dynamo.js`（`getRelevantMemories`）を `vi.mock()` でモジュールごと差し替えている。DynamoDB への保存は行わない機能のため `saveEvent` 等はモック対象外。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/actionPlanner/index.ts` | 不在時間の上限12時間（24時間空いても `elapsed` は「12時間」、プロンプトの開始日時は `now` の12時間前になり `lastLoginAt` そのものにはならないこと）、12時間未満はそのままの経過時間になること、`events` の番号付き反映（空なら「（なし）」）、`getRelevantMemories` がクエリ指定なしで呼ばれること、モデル応答の `actions` が配列ならそのまま・配列でなければ／fallbackなら空配列になること |

## 見つかった疑わしい挙動（`src/` は未修正）

- **`now` が `lastLoginAt` より前のとき、行動期間の開始（`actionStart`）が終了（`actionEnd`）より後になる**。`elapsedMs` が負のまま `Math.min` の対象になるため12時間には切り上がらず、`actionStart = now - elapsedMs`（`elapsedMs` が負なので実質 `now + |elapsedMs|`）が `actionEnd`（`now`）より未来の日時になり、プロンプトの「開始」「終了」が逆転する。詳細は作業報告（呼び出し元へのハンドバック）を参照。「現状の挙動の確認」の `describe` に確認用のテストを残している。
