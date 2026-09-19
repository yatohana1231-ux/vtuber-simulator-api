# emotionUpdater

キャラクターの感情値（mood）と関係値（perception）の差分を Bedrock で算出し、1〜100 にクランプして DynamoDB に保存する（`POST /emotion-updater`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runEmotionUpdater`。process=1 は最新の不在期間の記録（`getLatestAbsenceRecord` で読む。記録が無ければ LLM を呼ばず、保存もせずに現在の状態を返す）、process=2 はプレイヤー発言を入力にする（D-022）。差分の適用は `applyDelta` 1つで mood/perception の両方を扱い、有限の数値（`typeof === "number"` かつ `Number.isFinite`）でない差分（数字の文字列・`null`・`NaN` など）は 0（変化なし）として扱って `console.warn` に残す。応答全体や `moodDelta`/`perceptionDelta` がオブジェクトでないときも差分なしとして扱う（F-019・D-037） |
| `prompt.ts` | `buildEmotionUpdaterPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（D-017・D-022）。mood/perception の文章化は `lib/characterStateText.ts` を使う |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

mood/perception をプロンプト用の文章にする処理は `dialogueGenerator` と共通で、[`lib/characterStateText.ts`](../lib/characterStateText.ts) にある（A-9）。process=1 の入力文は `lib/absenceRecordText.ts` の `formatAbsenceRecordAsInputText` で作る（`memoryRetriever` と共通）。
