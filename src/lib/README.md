# lib

4つの機能とハンドラーから使う共有処理。

| ファイル | 内容 |
|---|---|
| `bedrock.ts` | Bedrock Converse API のラッパー。`invokeModel`（テキスト）と `invokeModelJson`（応答から JSON を抽出し、失敗時は既定値）。システムプロンプトは文字列1つか、変わりにくい順の層の配列で渡す。配列のときは層の境目にプロンプトキャッシュの区切り（`cachePoint`、最大4つ）を入れる（D-017。環境変数 `PROMPT_CACHE_ENABLED=false` で無効）。応答のトークン数（キャッシュの読み書きを含む）とモデル ID をログに出す。モデル ID は呼び出しのたびに決める（`options.modelId` → 環境変数 `BEDROCK_MODEL_ID` → `DEFAULT_MODEL_ID`〔Nova Lite〕の順。`resolveModelId`）。推論パラメータは `temperature: 0.8`（`options.temperature` で変えられる。AI 応答テストの採点は 0）に、モデルが対応する場合だけ `topP: 0.9` を足す |
| `modelProfiles.ts` | `getModelProfile(modelId)` — モデルごとの呼び出し方の違い（今は `topP` を受け付けるかだけ）。Nova は受け付け、Claude は `temperature` との併用でエラーになるため付けない（2026-09-19 に実測。未知のモデルは付けない） |
| `dynamo.ts` | DynamoDB（会話ログ／キャラクター記憶・状態／イベント）へのアクセスを集約。重要記憶は `getRelevantMemories(characterId, ...)` で重要度・新しさ・タグ一致により上位件数だけを返す。不在期間の記録は `saveAbsenceRecord`（イベントテーブルの履歴とキャラクター記憶テーブルの `absence-latest` をトランザクションで同時に保存）・`getLatestAbsenceRecord`（強い整合性で最新1件）・`getRecentAbsenceRecords`（GSI から直近 N 件、旧形式は読み飛ばす）。保存は `absenceSimulator`、最新1件の読み出しは後段の3機能が使う。関係の記録（D-033）は `index = "relationship"` の別レコードで、`getRelationshipRecord`（強い整合性）・`saveRelationshipRecord`。重要記憶の取得からは、`relationship` レコードと節目の記憶（`memoryType: relationship_milestone`）を除く。`getCharacterState(characterId, initialPerception?)` は、状態レコードが無いときキャラクターの初期値を返す |
| `packages.ts` | `packageId` からキャラクター×世界観×生活様式パッケージ（`api/content/`）を読み込む。ID 検証、コンテナ内キャッシュ、口調の例文の件数制限（最大5件）、`world.timezone`・`lifestyle`（生活リズム・出来事の種類）の形式検証を行う。キャラクターの `initialPerception`・`relationshipStages` の形式も検証する（D-033） |
| `apiHandler.ts` | 4本のハンドラーの共通処理（A-9、[D-030](../../../.notes/decision-history.md#d-030)）。`handleApiRequest(event, handle)` はイベントのログ出力 → `parseRequestBody` → `handle(body)` を行い、`BadRequestError` を 400（`{ "error": message }`）、それ以外の例外を 500（`error`・`errorName`・`errorMessage`）にする。壊れた JSON の body とオブジェクトでない JSON の body も 400 にする（F-018）。`requireCharacterId(body)`（空でない文字列だけを通す）・`requirePackage(packageId)` は、`characterId` の確認とパッケージの読み込みを行い、だめなら `BadRequestError` を投げる |
| `utils.ts` | リクエストボディのパース、レスポンス生成、値のクランプ（日時の表記は `timezone.ts` の `formatLocalDateTime`。2026-09-19 に `formatDatetimeJST` を削除） |
| `timezone.ts` | IANA タイムゾーンでの壁時計と瞬間の相互変換（`getLocalParts` / `localTimeToInstant`）。`Intl.DateTimeFormat` だけで実装し、DST のあるタイムゾーンにも対応する。`localTimeToInstant` の `day` は範囲外（0 や 32）でも暦を繰り上げ/繰り下げて扱う。`formatLocalDateTime` はプロンプト用の表記（`2026/09/18(金) 07:00`） |
| `absenceRecordText.ts` | `formatAbsenceRecordForPrompt(record, timeZone)` — 不在期間の記録を、後段の3機能（`dialogueGenerator`・`emotionUpdater`・`memoryRetriever`）のプロンプト用の文章（期間・出来事・行動・続いている話題）にする（D-022）。`formatAbsenceRecordAsInputText(record, timeZone)` は、それを `emotionUpdater`・`memoryRetriever`（どちらも process=1）の入力文（`【不在中の出来事】（期間: …）…【不在中の行動】…`）にまとめる |
| `characterStateText.ts` | `formatMoodForPrompt(mood)`・`formatPerceptionForPrompt(perception)` — mood/perception を、`emotionUpdater`・`dialogueGenerator` のプロンプト用の文章（`・喜び：35（低い）` を1項目1行）にする。値の段階のラベル（20以下「ほとんど感じない」〜81以上「強く感じる」）もここで決める（A-9） |
| `relationship.ts` | `advanceRelationship(input)` — 関係の記録を「下がる → 履歴の更新 → 戻る → 上がる」の順に進め、段階が変わった節目を返す（LLM も DB も使わない純粋な関数。D-033）。`DEMOTE_AFTER_DAYS`（60日話さないと1段階下がる。1回の不在で1段階だけ）・`RECOVERY_MESSAGES`（下がったあと5回の発言で元の段階に戻る）。上がるのは、次の段階の `promoteWhen` をすべて満たしたときに1段階ずつ。下がっている間は上がらない。発言した日数は世界観のタイムゾーンの日付で数え、時刻は `/dialogue-generator` の `now`（仮想時刻）を使う |
| `relationshipText.ts` | `formatRelationshipHistoryForPrompt(record, now, timeZone)` — 関係の記録を、プロンプトの【これまでの関係】の文章（例: 「出会ってから23日目。話した日は15日、会話は120回。最後に話したのは3日前。」）にする |
| `random.ts` | `weightedPick(items, weightOf)` — 重み付きで1つ選ぶ（`Math.random` を使う。重み0以下の要素は選ばない。空配列・重みの合計が0以下なら例外） |

## 注意

- `packages.ts` の読み込み先は環境変数 `CONTENT_DIR`、未設定なら `LAMBDA_TASK_ROOT/content`。ソースから直接実行する場合（`scripts/test-runner.ts`）は `CONTENT_DIR` が必要。
- 重要記憶と感情状態は同じテーブルの同じ `memory_id`（`characterId`）に同居している。`dynamo.ts` の記憶取得では `index = "state"` のレコードを除外している。
