# api/test/unit/dialogueGenerator

`src/dialogueGenerator/` の単体テスト。対象の概要は [`../../../src/dialogueGenerator/README.md`](../../../src/dialogueGenerator/README.md) を参照。

## 対象と方針

`runDialogueGenerator` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModel`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は低いレベルの関数（`getStoredAffectState`・`getRelevantMemories`・`getRecentLogs`・`saveConversationLog`・`getLatestAbsenceRecord`・`getRelationshipRecord`・`saveRelationshipRecord`・`saveMemory`・`saveCharacterAffectState`）をモックに差し替えている。状態を読んで時間を進める処理（`lib/affectStateStore.ts`・`lib/affect/`）は本物を使う（D-040）。`prompt.test.ts` はモックを使わない純粋な描画のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/dialogueGenerator/index.ts` | `message` が空のときの代替テキスト「（プレイヤーが来た）」（`invokeModel` へのuserメッセージ・保存されるuserログ・`getRelevantMemories` の `queryText` が `undefined` になることの3点）、`message` があるときはそのまま使われること、感情・関係値の状態は常に DynamoDB から読んで `now` まで進めた値を使うこと（状態レコードなし → 初期状態、古い形のレコード → 関係値だけ引き継ぐ、何日も後では強かった情動が「特になし」になる、終わったセッションの確定後の関係値で段階の判定がされる、今の気分の快が `getRelevantMemories` の `moodPleasure` に渡る、**状態レコードに書き込まない**。D-040）、保存順序（userログ保存 → `getRecentLogs(characterId, 10)` → `invokeModel` → assistantログ保存＝reply）、直近ログの末尾（今保存したuserログ）が会話履歴に含まれないこと、プロンプトに世界観・キャラクター名・口調の例文（`speechExamples` があるときだけ）・記憶が入ること、最新の不在期間の記録を `characterId` で読み、あればプロンプトに入り無ければセッション部が空文字になること、`invokeModel` に3層の配列が渡り `maxTokens` が 500 であること。関係の段階（D-033）: 関係の記録を `characterId` で読み、はじめての記録・発言あり/なしでの回数の増減を保存すること、段階が上がる条件で節目が `relationship_milestone` の重要記憶として保存され、プロンプトには入らないこと、保存がモデルの呼び出しより前であること、今の段階の文面がセッション部に入ること |
| `prompt.test.ts` | `src/dialogueGenerator/prompt.ts` | 固定部が入力によらず同じ文字列で日時を含まないこと（キャッシュの前提）、セッション部の不在期間の記録の部分が同じ記録なら同じ文字列・記録なしで出ない・出来事/行動/open の話題が入り closed の話題・`threadId`・`kind` が入らないこと、可変部に現在時刻（世界観のタイムゾーン表記）・感情・記憶・会話・念押しの一文・長期不在の備考（フラグ1のときだけ）が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと。関係の段階（D-033）: 固定部が段階・関係の記録・段階の例文を含まず同じ文字列であること、セッション部に段階の説明・話し方・段階の例文（無ければキャラクター共通の例文、両方無ければ見出しなし）が入り、記録が無くても空でなく、記録があれば段階の後に続くこと、可変部に【これまでの関係】が入ること |

## 感情・関係値の文章化について

感情（気分・強い情動・欲求）をプロンプト用の文章にする処理は `src/lib/affect/affectText.ts`（[`../lib/affect/`](../lib/affect/README.md) の `affectText.test.ts` で、8象限・強さ・ラベルの境目を確かめている）、関係値の文章化は `src/lib/characterStateText.ts`（[`../lib/README.md`](../lib/README.md) の `characterStateText.test.ts`）。このフォルダの `prompt.test.ts` では、それらの文章が【現在の感情状態】【プレイヤーへの感情】に入ること、関係値が整数に丸められて入ること、再会の【備考】の条件（孤独感 40 以上かつ発言が空。愛着のスタイルごとの文。`longTimeFlag` を渡しても文面が変わらない）を確かめる。

## 備考

以前は `conversation.mustache` の `{{ }}` で日付の `/` が HTML エスケープされていた（F-014）。2026-09-19 のテンプレートの3分割で、差し込みをすべて `{{{ }}}` にした。
