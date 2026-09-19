# handlers

Lambda のエントリーポイント。1ファイル = 1 Lambda = 1 エンドポイント（esbuild がそれぞれ `dist/<name>.mjs` にバンドルする）。

| ファイル | エンドポイント | 呼び出す関数 |
|---|---|---|
| `absenceSimulator.ts` | `POST /absence-simulator` | `runAbsenceSimulator` |
| `emotionUpdater.ts` | `POST /emotion-updater` | `runEmotionUpdater` |
| `memoryRetriever.ts` | `POST /memory-retriever` | `runMemoryRetriever` |
| `dialogueGenerator.ts` | `POST /dialogue-generator` | `runDialogueGenerator` |

## 共通の処理

1. `parseRequestBody` でボディをパースし、`characterId`（必須）などを検証する
2. `loadRequestedPackage(body.packageId)` でキャラクター×世界観パッケージを読み込む（省略時は既定パッケージ、不正・存在しない ID は 400）
3. 各機能のリクエスト型（`world` / `character` を含む）に詰め替えて `run*` を呼ぶ
4. `createResponse` でレスポンスを返す。例外は 500

`absenceSimulator.ts` は、`now` が `lastLoginAt` より前なら 400（`lastLoginAt must not be later than now`）を返す（D-020。削除した旧 `/event-resolver` は受け付けてしまっていた、F-020）。パッケージの生活様式（`lifestyle`）も `run*` に渡す。

ビジネスロジックは持たない。リクエスト仕様は [`../../README.md`](../../README.md) の「API 仕様」を参照。
