# api/test/unit/dialogueGenerator

`src/dialogueGenerator/` の単体テスト。対象の概要は [`../../../src/dialogueGenerator/README.md`](../../../src/dialogueGenerator/README.md) を参照。

## 対象と方針

`runDialogueGenerator` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModel`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は `vi.importActual` で `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を本物のまま残しつつ `getCharacterState`/`getRelevantMemories`/`getRecentLogs`/`saveConversationLog`/`getLatestAbsenceRecord` をモックに差し替えている。`prompt.test.ts` はモックを使わない純粋な描画のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/dialogueGenerator/index.ts` | `message` が空のときの代替テキスト「（プレイヤーが来た）」（`invokeModel` へのuserメッセージ・保存されるuserログ・`getRelevantMemories` の `queryText` が `undefined` になることの3点）、`message` があるときはそのまま使われること、`mood`/`perception` を両方指定すると `getCharacterState` を呼ばないこと・片方でも欠けると呼んでその値を使うこと、保存順序（userログ保存 → `getRecentLogs(characterId, 10)` → `invokeModel` → assistantログ保存＝reply）、直近ログの末尾（今保存したuserログ）が会話履歴に含まれないこと、プロンプトに世界観・キャラクター名・口調の例文（`speechExamples` があるときだけ）・記憶・mood/perceptionのラベル（境界値 40/41, 80/81）・`longTimeFlag=1` の記述が入ること、最新の不在期間の記録を `characterId` で読み、あればプロンプトに入り無ければセッション部が空文字になること、`invokeModel` に3層の配列が渡り `maxTokens` が 500 であること |
| `prompt.test.ts` | `src/dialogueGenerator/prompt.ts` | 固定部が入力によらず同じ文字列で日時を含まないこと（キャッシュの前提）、セッション部が同じ記録なら同じ文字列・記録なしで空文字・出来事/行動/open の話題が入り closed の話題・`threadId`・`kind` が入らないこと、可変部に現在時刻（世界観のタイムゾーン表記）・感情・記憶・会話・念押しの一文・長期不在の備考（フラグ1のときだけ）が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |

## mood/perceptionの整形ヘルパーについて

`emotionUpdater`（[`../emotionUpdater/README.md`](../emotionUpdater/README.md)）と `dialogueGenerator` にはほぼ同じ `MOOD_LABELS`/`PERCEPTION_LABELS`/`toLabel`/`formatState` が別々に存在する。境界値のテストはこのファイルでは 40/41・80/81、`emotionUpdater` 側では 20/21・60/61 を確認しており、両方をあわせて `toLabel` の5段階（20以下／21〜40／41〜60／61〜80／81以上）を一通りカバーしている。

## 備考

以前は `conversation.mustache` の `{{ }}` で日付の `/` が HTML エスケープされていた（F-014）。2026-09-19 のテンプレートの3分割で、差し込みをすべて `{{{ }}}` にした。
