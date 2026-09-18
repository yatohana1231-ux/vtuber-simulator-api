# api/test/unit/dialogueGenerator

`src/dialogueGenerator/` の単体テスト。対象の概要は [`../../../src/dialogueGenerator/README.md`](../../../src/dialogueGenerator/README.md) を参照。

## 対象と方針

`runDialogueGenerator` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModel`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は `vi.importActual` で `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を本物のまま残しつつ `getCharacterState`/`getRelevantMemories`/`getRecentLogs`/`saveConversationLog` をモックに差し替えている。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/dialogueGenerator/index.ts` | `message` が空のときの代替テキスト「（プレイヤーが来た）」（`invokeModel` へのuserメッセージ・保存されるuserログ・`getRelevantMemories` の `queryText` が `undefined` になることの3点）、`message` があるときはそのまま使われること、`mood`/`perception` を両方指定すると `getCharacterState` を呼ばないこと・片方でも欠けると呼んでその値を使うこと、保存順序（userログ保存 → `getRecentLogs(characterId, 10)` → `invokeModel` → assistantログ保存＝reply）、直近ログの末尾（今保存したuserログ）が会話履歴に含まれないこと、プロンプトに世界観・キャラクター名・口調の例文（`speechExamples` があるときだけ）・記憶・mood/perceptionのラベル（境界値 40/41, 80/81）・`events`/`actions`（あるときだけ）・`longTimeFlag=1` の記述が入ること、`invokeModel` の `maxTokens` が 500 であること |

## mood/perceptionの整形ヘルパーについて

`emotionUpdater`（[`../emotionUpdater/README.md`](../emotionUpdater/README.md)）と `dialogueGenerator` にはほぼ同じ `MOOD_LABELS`/`PERCEPTION_LABELS`/`toLabel`/`formatState` が別々に存在する。境界値のテストはこのファイルでは 40/41・80/81、`emotionUpdater` 側では 20/21・60/61 を確認しており、両方をあわせて `toLabel` の5段階（20以下／21〜40／41〜60／61〜80／81以上）を一通りカバーしている。

## 備考

`prompts/conversation.mustache` の `{{historyText}}`・`{{currentDatetime}}` などは `{{ }}`（二重波括弧）で出力されており、Mustache の HTML エスケープの対象になっている（[`.notes/followup/F-014.md`](../../../../.notes/followup/F-014.md)）。実際に `currentDatetime`（`2026/08/11 23:30` のような日付）が `2026&#x2F;08&#x2F;11 23:30` のようにエスケープされることをテスト実行中のプロンプトで確認した。このテストではエスケープの有無に依存しない文字列（`/` や引用符を含まない部分）だけを `toContain` で確認しており、エスケープされた挙動自体を正しいものとして固定するアサーションは書いていない。
