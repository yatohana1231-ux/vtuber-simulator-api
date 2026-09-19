# api/test/unit/dialogueGenerator

`src/dialogueGenerator/` の単体テスト。対象の概要は [`../../../src/dialogueGenerator/README.md`](../../../src/dialogueGenerator/README.md) を参照。

## 対象と方針

`runDialogueGenerator` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModel`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は `vi.importActual` で `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を本物のまま残しつつ `getCharacterState`/`getRelevantMemories`/`getRecentLogs`/`saveConversationLog`/`getLatestAbsenceRecord` をモックに差し替えている。`prompt.test.ts` はモックを使わない純粋な描画のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/dialogueGenerator/index.ts` | `message` が空のときの代替テキスト「（プレイヤーが来た）」（`invokeModel` へのuserメッセージ・保存されるuserログ・`getRelevantMemories` の `queryText` が `undefined` になることの3点）、`message` があるときはそのまま使われること、`mood`/`perception` は常に `getCharacterState`（`characterId`）の値がプロンプトに入り、値が無ければ既定値になること（D-032）、保存順序（userログ保存 → `getRecentLogs(characterId, 10)` → `invokeModel` → assistantログ保存＝reply）、直近ログの末尾（今保存したuserログ）が会話履歴に含まれないこと、プロンプトに世界観・キャラクター名・口調の例文（`speechExamples` があるときだけ）・記憶・mood/perceptionのラベル（境界値 40/41, 80/81）・`longTimeFlag=1` の記述が入ること、最新の不在期間の記録を `characterId` で読み、あればプロンプトに入り無ければセッション部が空文字になること、`invokeModel` に3層の配列が渡り `maxTokens` が 500 であること。関係の段階（D-033）: 関係の記録を `characterId` で読み、はじめての記録・発言あり/なしでの回数の増減を保存すること、段階が上がる条件で節目が `relationship_milestone` の重要記憶として保存され、プロンプトには入らないこと、保存がモデルの呼び出しより前であること、今の段階の文面がセッション部に入ること |
| `prompt.test.ts` | `src/dialogueGenerator/prompt.ts` | 固定部が入力によらず同じ文字列で日時を含まないこと（キャッシュの前提）、セッション部の不在期間の記録の部分が同じ記録なら同じ文字列・記録なしで出ない・出来事/行動/open の話題が入り closed の話題・`threadId`・`kind` が入らないこと、可変部に現在時刻（世界観のタイムゾーン表記）・感情・記憶・会話・念押しの一文・長期不在の備考（フラグ1のときだけ）が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと。関係の段階（D-033）: 固定部が段階・関係の記録・段階の例文を含まず同じ文字列であること、セッション部に段階の説明・話し方・段階の例文（無ければキャラクター共通の例文、両方無ければ見出しなし）が入り、記録が無くても空でなく、記録があれば段階の後に続くこと、可変部に【これまでの関係】が入ること |

## mood/perceptionの整形について

mood/perception をプロンプト用の文章にする処理は、2026-09-19 に `emotionUpdater` と共通の `src/lib/characterStateText.ts` にまとめた（A-9）。段階のラベルの境界値（20/21・40/41・60/61・80/81）は [`../lib/README.md`](../lib/README.md) の `characterStateText.test.ts` で一通り確かめている。このファイルの 40/41・80/81 の確認は、`dialogueGenerator` のプロンプトにラベルが入ることの確認として残している。

## 備考

以前は `conversation.mustache` の `{{ }}` で日付の `/` が HTML エスケープされていた（F-014）。2026-09-19 のテンプレートの3分割で、差し込みをすべて `{{{ }}}` にした。
