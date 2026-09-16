# dialogueGenerator

感情値・関係値、重要記憶、直近の会話、不在中の出来事・行動を踏まえて、キャラクターのセリフを Bedrock で生成する（`POST /dialogue-generator`）。プレイヤーの発言とセリフは会話ログに保存する。

| パス | 内容 |
|---|---|
| `index.ts` | `runDialogueGenerator`。重要記憶はプレイヤー発言をクエリにして上位8件を取得。mood/perception がリクエストに無ければ DynamoDB から取得する |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- キャラクターの設定・口調の例文・世界観はパッケージ（`api/content/`）から差し込む。口調の例文を使うのはこの機能だけ。
- mood/perception をプロンプト用テキストに整形するヘルパー（`MOOD_LABELS` など）は `emotionUpdater/index.ts` にもほぼ同じものがある。片方を直すときはもう片方も確認すること。
