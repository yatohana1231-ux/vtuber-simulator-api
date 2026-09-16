# memoryRetriever

出来事・会話を Bedrock で重要度判定し、残すべきものを重要記憶として `character_memory` テーブルに保存する（`POST /memory-retriever`）。

| パス | 内容 |
|---|---|
| `index.ts` | `runMemoryRetriever`。process=1 は不在中の出来事・行動、process=2 は直近5往復の会話ログ（未判定かつ10件以上の場合のみ）を判定する |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- 記憶は `memory_id = characterId` で保存する。
- 重複保存を避けるため、判定時に既存の記憶を他の機能より広め（上位20件、重要度10以上）に取得してプロンプトに渡している。
