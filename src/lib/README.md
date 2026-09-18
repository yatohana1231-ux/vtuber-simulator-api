# lib

5つの機能とハンドラーから使う共有処理。

| ファイル | 内容 |
|---|---|
| `bedrock.ts` | Bedrock Converse API のラッパー。`invokeModel`（テキスト）と `invokeModelJson`（応答から JSON を抽出し、失敗時は既定値） |
| `dynamo.ts` | DynamoDB（会話ログ／キャラクター記憶・状態／イベント）へのアクセスを集約。重要記憶は `getRelevantMemories(characterId, ...)` で重要度・新しさ・タグ一致により上位件数だけを返す |
| `packages.ts` | `packageId` からキャラクター×世界観×生活様式パッケージ（`api/content/`）を読み込む。ID 検証、コンテナ内キャッシュ、口調の例文の件数制限（最大5件）、`world.timezone`・`lifestyle`（生活リズム・出来事の種類）の形式検証を行う |
| `utils.ts` | リクエストボディのパース、レスポンス生成、JST 日時整形、値のクランプ |
| `timezone.ts` | IANA タイムゾーンでの壁時計と瞬間の相互変換（`getLocalParts` / `localTimeToInstant`）。`Intl.DateTimeFormat` だけで実装し、DST のあるタイムゾーンにも対応する。`localTimeToInstant` の `day` は範囲外（0 や 32）でも暦を繰り上げ/繰り下げて扱う |
| `random.ts` | `weightedPick(items, weightOf)` — 重み付きで1つ選ぶ（`Math.random` を使う。重み0以下の要素は選ばない。空配列・重みの合計が0以下なら例外） |

## 注意

- `packages.ts` の読み込み先は環境変数 `CONTENT_DIR`、未設定なら `LAMBDA_TASK_ROOT/content`。ソースから直接実行する場合（`scripts/test-runner.ts`）は `CONTENT_DIR` が必要。
- 重要記憶と感情状態は同じテーブルの同じ `memory_id`（`characterId`）に同居している。`dynamo.ts` の記憶取得では `index = "state"` のレコードを除外している。
