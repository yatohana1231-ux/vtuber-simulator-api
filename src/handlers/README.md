# handlers

Lambda のエントリーポイント。1ファイル = 1 Lambda = 1 エンドポイント（esbuild がそれぞれ `dist/<name>.mjs` にバンドルする）。

| ファイル | エンドポイント | 呼び出す関数 |
|---|---|---|
| `absenceSimulator.ts` | `POST /absence-simulator` | `runAbsenceSimulator` |
| `emotionUpdater.ts` | `POST /emotion-updater` | `runEmotionUpdater` |
| `memoryRetriever.ts` | `POST /memory-retriever` | `runMemoryRetriever` |
| `dialogueGenerator.ts` | `POST /dialogue-generator` | `runDialogueGenerator` |

## 共通の処理

4本とも [`lib/apiHandler.ts`](../lib/apiHandler.ts) の `handleApiRequest(event, handle)` の中に、次の順で処理を書く（A-9、[D-030](../../../.notes/decision-history.md#d-030)）。ログ出力・ボディのパース・例外のレスポンスへの変換は `handleApiRequest` が行う。

1. `requireCharacterId(body)` で `characterId`（必須）を確かめる
2. 各ハンドラーに固有の入力チェック（`process`、`now`/`lastLoginAt`）を行う。不正なら `BadRequestError` を投げる（400 になる）
3. `requirePackage(body.packageId)` でキャラクター×世界観パッケージを読み込む（省略時は既定パッケージ、不正・存在しない ID は 400）
4. 各機能のリクエスト型（`world` / `character` を含む）に詰め替えて `run*` を呼ぶ
5. `createResponse(200, …)` でレスポンスを返す。`BadRequestError` 以外の例外は 500

`absenceSimulator.ts` は、`now` が `lastLoginAt` より前なら 400（`lastLoginAt must not be later than now`）を返す（D-020。削除した旧 `/event-resolver` は受け付けてしまっていた、F-020）。パッケージの生活様式（`lifestyle`）も `run*` に渡す。

ビジネスロジックは持たない。リクエスト仕様は [`../../README.md`](../../README.md) の「API 仕様」を参照。
