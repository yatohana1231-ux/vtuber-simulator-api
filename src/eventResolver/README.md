# eventResolver

プレイヤー不在期間中にキャラクターが経験した出来事を Bedrock で生成し、`events` テーブルに保存する（`POST /event-resolver`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runEventResolver`。重要記憶（クエリなし、上位8件）を取得してプロンプトを組み立て、生成結果を保存して返す |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |
| `template/` | 旧 `enhance-v1` 計画の実験用ファイル（未コミット・ランタイム未使用。`CLAUDE.md` 参照） |

世界観やキャラクター設定はテンプレートに直書きせず、パッケージ（`api/content/`）から `{{> world}}` と `{{character.background}}` で差し込む。
