# api/test/unit/lib

`src/lib/` の単体テスト。対象ファイルの概要は [`../../../src/lib/README.md`](../../../src/lib/README.md) を参照。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `utils.test.ts` | `src/lib/utils.ts` | `parseRequestBody` / `clamp` / `createResponse` |
| `absenceRecordText.test.ts` | `src/lib/absenceRecordText.ts` | `formatAbsenceRecordForPrompt`: 期間の表記（タイムゾーンの変換・日付またぎ）、出来事の2行形式と番号（`kind`・`threadId` は出さない）、行動の `memo` あり/なし、open の話題だけを出すこと、各項目が0件のときの「（なし）」、`/` がエスケープされないこと |
| `timezone.test.ts` | `src/lib/timezone.ts` | `getLocalParts`（Asia/Tokyo での日付の繰り上がりと曜日）、`localTimeToInstant`（JST→UTC、`day` の範囲外〔月末・前月末・年末〕の繰り上がり/繰り下がり、往復変換、America/New_York の冬時間・夏時間）、`formatLocalDateTime`（曜日・ゼロ埋め・日付の繰り上がり） |
| `random.test.ts` | `src/lib/random.ts` | `weightedPick`: 乱数の境界（0 → 先頭、1未満の最大付近 → 末尾）、重みの比に応じた区間、重み0・負の要素を選ばないこと、浮動小数の誤差時のフォールバック、空配列・重みの合計が0以下で例外 |
| `bedrock.test.ts` | `src/lib/bedrock.ts` | `invokeModel`（`BedrockRuntimeClient.prototype.send` を `vi.spyOn` で差し替え。content の連結・trim、output なしの空文字、`ConverseCommand` の input）と `invokeModelJson`（フェンス付き／裸／説明文付き裸の JSON のパース、JSON なし・壊れた JSON での fallback）。システムプロンプトを層の配列で渡したときの `cachePoint` の位置（2層・3層、空の層、最大4つ）、`PROMPT_CACHE_ENABLED=false` で区切りなし、`invokeModelJson` でも同じ、usage のログ（無い応答でも落ちない。モデル ID を含む）、モデル ID の決まり方（`options.modelId` → 呼び出し時点の環境変数 → 既定値）、Nova では `topP` が入り Claude では入らないこと、`invokeModelJson` への `options.modelId` の受け渡し |
| `modelProfiles.test.ts` | `src/lib/modelProfiles.ts` | Nova の各 ID（推論プロファイルの接頭辞あり・なし）で `topP` 対応、Claude の各 ID と未知の ID で非対応 |
| `dynamo.test.ts` | `src/lib/dynamo.ts` | export されている `dynamo.send` を `vi.spyOn` で差し替え。`getRelevantMemories`（`state`・`absence-latest` レコードの除外、`minImportance` 既定値／指定値での絞り込み、新しさ減衰込みのスコアリング順、タグ一致ボーナス、`topK` 既定値／指定値、`KeyConditionExpression` への `characterId` の受け渡し）、`getCharacterState`（既定値のコピーを返すこと・既定値自体は変更されないこと）、`extractTableName`（`vi.stubEnv` + `vi.resetModules()` + 動的 import で ARN 正規化・未設定時の扱いを確認）、`saveConversationLog` / `getRecentLogs`（降順取得を古い順に並べ替え）/ `markLogsAsJudged` の送信内容、`saveAbsenceRecord`（`TransactWriteCommand` で2テーブルへ同時に Put）/ `getLatestAbsenceRecord`（`ConsistentRead`、項目なし・旧形式で null）/ `getRecentAbsenceRecords`（GSI・降順のクエリ、旧形式の読み飛ばし、`ExclusiveStartKey` での続きのページ、`limit` 件・最大ページ数での打ち切り、`limit` 0以下で送信しない） |
| `packages.test.ts` | `src/lib/packages.ts` | 本物の `api/content/` を読み、`loadRequestedPackage`（省略時の既定パッケージ、文字列以外・形式不正・存在しない ID で null）と `loadPackage`（world/character/lifestyle の解決、`world.timezone` と `lifestyle.schedules`/`eventKinds` の内容）、`isValidPackageId` を確認。`speechExamples` の5件切り詰め、参照先の world/character/lifestyle 欠落時の例外、`world.timezone` 欠落・不正なタイムゾーン文字列での例外、`lifestyle` のスケジュール枠（`start`/`end` の形式不正・`start === end`）と `eventKinds`（空配列・`weight` が0以下）の形式不正での例外、日をまたぐ枠（`23:00`→`07:00`）を受け付けること、`CONTENT_DIR`/`LAMBDA_TASK_ROOT` 両方未設定時の例外、`LAMBDA_TASK_ROOT/content` からの読み込みは `fs.mkdtemp` の一時ディレクトリ＋`vi.stubEnv`＋`vi.resetModules()` で確認 |

`handlers/` のテストは [`../handlers/README.md`](../handlers/README.md) を参照。各機能モジュール本体（`absenceSimulator` / `emotionUpdater` / `memoryRetriever` / `dialogueGenerator` の `run*` の中身）のテストは `../absenceSimulator/README.md` などフォルダごとに用意している。
