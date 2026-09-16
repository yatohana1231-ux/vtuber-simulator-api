# emotionUpdater

キャラクターの感情値（mood）と関係値（perception）の差分を Bedrock で算出し、1〜100 にクランプして DynamoDB に保存する（`POST /emotion-updater`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runEmotionUpdater`。process=1 は不在中の出来事・行動、process=2 はプレイヤー発言を入力にする |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

mood/perception をプロンプト用テキストに整形するヘルパー（`MOOD_LABELS` など）は `dialogueGenerator/index.ts` にもほぼ同じものがある。片方を直すときはもう片方も確認すること。
