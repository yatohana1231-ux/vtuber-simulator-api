# handlers

Lambda のエントリーポイント。1ファイル = 1 Lambda = 1 エンドポイント（esbuild がそれぞれ `dist/<name>.mjs` にバンドルする）。

| ファイル | エンドポイント | 呼び出す関数 |
|---|---|---|
| `absenceSimulator.ts` | `POST /absence-simulator` | `runAbsenceSimulator` |
| `emotionUpdater.ts` | `POST /emotion-updater` | `runEmotionUpdater` |
| `memoryRetriever.ts` | `POST /memory-retriever` | `runMemoryRetriever` |
| `dialogueGenerator.ts` | `POST /dialogue-generator` | `runDialogueGenerator` |
| `testerCharacters.ts` | `GET`/`POST /characters` | `runListTesterCharacters` / `runCreateTesterCharacter` |
| `debugCharacterState.ts` | `POST /debug-character-state`（デバッグ専用。stg のみ） | `runDebugCharacterState` |

## 共通の処理

4本とも [`lib/apiHandler.ts`](../lib/apiHandler.ts) の `handleApiRequest(event, handle)` の中に、次の順で処理を書く（A-9、[D-030](../../../.notes/decision-history.md#d-030)）。ログ出力・ボディのパース（壊れた JSON・オブジェクトでない JSON は 400。F-018）・例外のレスポンスへの変換は `handleApiRequest` が行う。

1. `requireCharacterId(body)` で `characterId`（必須。空でない文字列）を確かめる
2. 各ハンドラーに固有の入力チェック（`process`、`now`/`lastLoginAt`）を行う。不正なら `BadRequestError` を投げる（400 になる）
3. `requirePackage(body.packageId)` でキャラクター×世界観パッケージを読み込む（省略時は既定パッケージ、不正・存在しない ID は 400）
4. 各機能のリクエスト型（`world` / `character` を含む）に詰め替えて `run*` を呼ぶ
5. `createResponse(200, …)` でレスポンスを返す。`BadRequestError` 以外の例外は 500

`absenceSimulator.ts` は、`now` が `lastLoginAt` より前なら 400（`lastLoginAt must not be later than now`）を返す（D-020。削除した旧 `/event-resolver` は受け付けてしまっていた、F-020）。パッケージの生活様式（`lifestyle`）も `run*` に渡す。

`debugCharacterState.ts` も同じ流れ（`handleApiRequest` を使うので、持ち主の確認も効く）。固有のチェックは `mood`・`perception` の検証（`validateStateField`。省略可、指定するなら6項目すべてを 1〜100 の整数。不足・余分・`null`・整数でない・範囲外は 400 で、丸めない）で、パッケージの読み込みの後に行う（`character.initialPerception` を `run*` に渡すため）。D-038。

ビジネスロジックは持たない。リクエスト仕様は [`../../README.md`](../../README.md) の「API 仕様」を参照。

## `testerCharacters.ts`（`/characters`）

上記4本は POST 専用で `handleApiRequest` を共有しているが、`/characters` は `GET`（一覧）と `POST`（作成）の両方を1つの Lambda で扱うため、`handleApiRequest` は使わず（`httpMethod` を見ないため）、ログ出力だけ `apiHandler.ts` の `summarizeEventForLog` を共有する。処理の流れ:

1. `summarizeEventForLog(event)` でログ出力（秘密のヘッダーを出さない）
2. `getTesterIdFromEvent(event)` が `null` なら 403 `{"error":"forbidden"}`（`/characters` は常にテスターの ID が必要）
3. `httpMethod` で分岐: `GET` → `runListTesterCharacters(testerId)` を呼び 200、`POST` → body をパース（壊れた JSON・オブジェクトでない body は 400。無ければ `{}`）して `runCreateTesterCharacter(testerId, { packageId, label })` を呼び 201、それ以外 → 405 `{"error":"method not allowed"}`
4. `TesterCharacterInputError`（`src/testerCharacters/index.ts`）は 400、`TesterCharacterLimitError` は 409 `{"error":"character limit reached"}`、それ以外の例外は 500（`error`・`errorName`・`errorMessage`。4本の既存ハンドラーと同じ形）
