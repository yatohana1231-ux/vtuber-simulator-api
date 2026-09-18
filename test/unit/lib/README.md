# api/test/unit/lib

`src/lib/` の単体テスト。対象ファイルの概要は [`../../../src/lib/README.md`](../../../src/lib/README.md) を参照。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `utils.test.ts` | `src/lib/utils.ts` | `formatDatetimeJST` / `parseRequestBody` / `clamp` / `createResponse` |
| `bedrock.test.ts` | `src/lib/bedrock.ts` | `invokeModel`（`BedrockRuntimeClient.prototype.send` を `vi.spyOn` で差し替え。content の連結・trim、output なしの空文字、`ConverseCommand` の input）と `invokeModelJson`（フェンス付き／裸／説明文付き裸の JSON のパース、JSON なし・壊れた JSON での fallback） |
| `dynamo.test.ts` | `src/lib/dynamo.ts` | export されている `dynamo.send` を `vi.spyOn` で差し替え。`getRelevantMemories`（`state` レコードの除外、`minImportance` 既定値／指定値での絞り込み、新しさ減衰込みのスコアリング順、タグ一致ボーナス、`topK` 既定値／指定値、`KeyConditionExpression` への `characterId` の受け渡し）、`getCharacterState`（既定値のコピーを返すこと・既定値自体は変更されないこと）、`extractTableName`（`vi.stubEnv` + `vi.resetModules()` + 動的 import で ARN 正規化・未設定時の扱いを確認）、`saveConversationLog` / `getRecentLogs`（降順取得を古い順に並べ替え）/ `markLogsAsJudged` の送信内容 |
| `packages.test.ts` | `src/lib/packages.ts` | 本物の `api/content/` を読み、`loadRequestedPackage`（省略時の既定パッケージ、文字列以外・形式不正・存在しない ID で null）と `loadPackage`（world/character/lifestyle の解決、`world.timezone` と `lifestyle.schedules`/`eventKinds` の内容）、`isValidPackageId` を確認。`speechExamples` の5件切り詰め、参照先の world/character/lifestyle 欠落時の例外、`world.timezone` 欠落・不正なタイムゾーン文字列での例外、`lifestyle` のスケジュール枠（`start`/`end` の形式不正・`start === end`）と `eventKinds`（空配列・`weight` が0以下）の形式不正での例外、日をまたぐ枠（`23:00`→`07:00`）を受け付けること、`CONTENT_DIR`/`LAMBDA_TASK_ROOT` 両方未設定時の例外、`LAMBDA_TASK_ROOT/content` からの読み込みは `fs.mkdtemp` の一時ディレクトリ＋`vi.stubEnv`＋`vi.resetModules()` で確認 |

`handlers/` のテストは [`../handlers/README.md`](../handlers/README.md) を参照。各機能モジュール本体（`eventResolver` / `actionPlanner` / `emotionUpdater` / `memoryRetriever` / `dialogueGenerator` の `run*` の中身）のテストは `../eventResolver/README.md` などフォルダごとに用意している。
