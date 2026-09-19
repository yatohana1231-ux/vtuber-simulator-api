# memoryRetriever

出来事・会話を Bedrock で重要度判定し、残すべきものを重要記憶として `character_memory` テーブルに保存する（`POST /memory-retriever`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runMemoryRetriever`。process=1 は最新の不在期間の記録（`getLatestAbsenceRecord` で読み、`lib/absenceRecordText.ts` の `formatAbsenceRecordAsInputText` で入力文にする〔`emotionUpdater` と共通〕。記録が無ければ何もしない。D-022）、process=2 は直近5往復の会話ログ（未判定かつ10件以上の場合のみ）を判定する |
| `prompt.ts` | `buildMemoryRetrieverPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（D-017・D-022） |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- 記憶は `memory_id = characterId` で保存する。
- 重複保存を避けるため、判定時に既存の記憶を他の機能より広め（上位20件、重要度10以上）に取得してプロンプトに渡している。

- **感情の向き `emotionValence`（D-040）**: 候補の出力に `emotionValence`（`positive`・`negative`・`neutral`）を足し、3つの値のどれかならそのまま保存する（省略・不正な値は項目を付けない）。`dialogueGenerator` が重要記憶を読むときに、今の気分の快・不快と同じ向きの記憶のスコアにボーナスをかける（気分一致の記憶。`lib/dynamo.ts` の `getRelevantMemories` の `moodPleasure`）。この項目が無い古い記憶にはボーナスがかからない。
