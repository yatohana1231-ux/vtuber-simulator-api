# emotionUpdater

キャラクターの感情値（mood）と関係値（perception）の差分を Bedrock で算出し、1〜100 にクランプして DynamoDB に保存する（`POST /emotion-updater`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runEmotionUpdater`。process=1 は最新の不在期間の記録（`getLatestAbsenceRecord` で読む。記録が無ければ LLM を呼ばず、保存もせずに現在の状態を返す）、process=2 はプレイヤー発言を入力にする（D-022） |
| `prompt.ts` | `buildEmotionUpdaterPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（D-017・D-022）。mood/perception の整形ヘルパーもここにある |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

mood/perception をプロンプト用テキストに整形するヘルパー（`MOOD_LABELS` など。`prompt.ts`）は `dialogueGenerator/prompt.ts` にもほぼ同じものがある。片方を直すときはもう片方も確認すること。
