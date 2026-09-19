# api/test/unit/memoryRetriever

`src/memoryRetriever/` の単体テスト。対象の概要は [`../../../src/memoryRetriever/README.md`](../../../src/memoryRetriever/README.md) を参照。

## 対象と方針

`runMemoryRetriever` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）と `../../../src/lib/dynamo.js`（`getRelevantMemories`・`getLogsForMemoryJudge`・`markLogsAsJudged`・`saveMemory`）を `vi.mock()` でモジュールごと差し替えている。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/memoryRetriever/index.ts` | process1（最新の不在期間の記録が無ければモデル・DynamoDB の保存のどちらも呼ばない、あれば記録の出来事と世界観のタイムゾーン表記の行動を入力にして判定する。process2 では記録を読まない）、process2（ログ10件未満・判定済みフラグを含む場合はスキップし、10件そろって未判定のときだけモデルを呼ぶ。会話がプレイヤー名／キャラクター名付きでプロンプトに入ること、`markLogsAsJudged` に全ログの `index` が渡ること、`getLogsForMemoryJudge` が `(characterId, 5)` で呼ばれること）、保存対象の絞り込み（`shouldRemember: true` かつ `memoryLabel !== "IGNORE"` のときだけ `saveMemory` される、`candidates` が配列でない・fallbackなら何も保存しない）、`saveMemory` の保存内容、`getRelevantMemories` が `{ queryText, topK: 20, minImportance: 10 }` で呼ばれること、`invokeModelJson` に2層の配列が渡ること |
| `prompt.test.ts` | `src/memoryRetriever/prompt.ts` | 固定部が記憶・入力によらず同じ文字列で、それらを含まないこと（キャッシュの前提）、可変部に既存の記憶・判定対象・念押しの一文が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |

## 型と実装の食い違い（`src/` は未修正）

`MemoryCandidate` 型（`src/types.ts`）には `memoryLabel` フィールドが定義されていないが、`src/memoryRetriever/index.ts` の保存フィルタは `(c as MemoryCandidate & { memoryLabel?: string }).memoryLabel !== "IGNORE"` という型アサーション付きキャストで参照している。プロンプト（`prompts/memoryRetriever.fixed.mustache`）はモデルに `memoryLabel`（`CREATE`/`UPDATE`/`IGNORE`/`CONFLICT`）を出力させる指示をしており、実行時の挙動は意図どおり（`IGNORE` は保存対象から除外される）だが、型定義だけを見ると `memoryLabel` を使ったフィルタ条件を追跡できない。`index.test.ts` の「型と実装の食い違い（現状の挙動）」に `it.todo` として記録している（対応は本フェーズの対象外）。詳細は作業報告（呼び出し元へのハンドバック）を参照。
