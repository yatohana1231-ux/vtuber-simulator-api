# memoryRetriever

出来事・会話を Bedrock で重要度判定し、残すべきものを重要記憶として `character_memory` テーブルに保存する（`POST /memory-retriever`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runMemoryRetriever`。process=1 は最新の不在期間の記録（`getLatestAbsenceRecord` で読む。記録が無ければ何もしない。D-022）、process=2 は直近5往復の会話ログ（未判定かつ10件以上の場合のみ）を判定する |
| `prompt.ts` | `buildMemoryRetrieverPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（D-017・D-022） |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- 記憶は `memory_id = characterId` で保存する。
- 重複保存を避けるため、判定時に既存の記憶を他の機能より広め（上位20件、重要度10以上）に取得してプロンプトに渡している。
