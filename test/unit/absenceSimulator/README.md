# api/test/unit/absenceSimulator

`src/absenceSimulator/` の単体テスト。対象の概要は [`../../../src/absenceSimulator/README.md`](../../../src/absenceSimulator/README.md) を参照。`index.test.ts` 以外は外部サービス（Bedrock・DynamoDB）を使わない純粋な計算のテスト。`index.test.ts` は `lib/bedrock.js`・`lib/dynamo.js` を `vi.mock()` で差し替え、骨格・プロンプト・突き合わせは本物を使う。乱数は `vi.spyOn(Math, "random")`、現在時刻は `vi.useFakeTimers()` + `vi.setSystemTime()` で固定する。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/absenceSimulator/index.ts` | `runAbsenceSimulator`: レスポンスの出来事が `kind`/`summary`/`detail` だけを持ち行動の時刻が骨格どおりであること、保存する記録の内容（UUID・`createdAt`＝現在時刻）、`invokeModelJson` にプロンプトが層の配列・`EMPTY_MODEL_OUTPUT`・`MAX_OUTPUT_TOKENS` で渡ること、直近3件の記録の出来事の要約が可変部に入ること、続いている話題（可変部への反映・LLM による close・新しい話題）、最新の記録が無いとき、Bedrock の例外・パース失敗でのフォールバック（記録は保存し、前回の話題を引き継ぐ）、保存の失敗は例外になること、固定部が入力によらず同じ文字列になること |
| `actionSlots.test.ts` | `src/absenceSimulator/actionSlots.ts` | `buildActionSlots`: 期間が空・逆転のとき空配列、平日だけの期間、平日→休日（金曜夜〜土曜朝）で枠の間が空くこと、休日→平日（日曜夜〜月曜朝）で就寝が月曜の起床に切り詰められること、前日から続く日をまたぐ枠が期間の先頭で切り詰められること、期間の端で15分未満になった枠を捨てること、戻り値が昇順で重ならないこと、本物の `tokyo-highschool-vtuber` で12時間を展開したとき全枠が期間内に収まり重ならないこと |
| `eventKindSelection.test.ts` | `src/absenceSimulator/eventKindSelection.ts` | `countEvents` の境界（0以下、1ミリ秒、3時間、11時間59分、12・24・36・48時間、1週間）、`pickEventKinds` の件数（0・負で空配列）と乱数に応じた種類、本物の `eventKinds` での動作 |
| `skeleton.test.ts` | `src/absenceSimulator/skeleton.ts` | `buildAbsenceSkeleton`: 不在3時間で行動の枠3時間分・出来事1件、不在30時間で行動の枠が直近12時間に収まり出来事は3件、`now` が `lastLoginAt` より前なら行動の枠・出来事とも空、期間の ISO 文字列、乱数に応じた種類 |
| `prompt.test.ts` | `src/absenceSimulator/prompt.ts` | 固定部が骨格・日時・話題・記憶の違う入力でも完全に同じ文字列になること（キャッシュの前提）、固定部の内容（キャラクター名・世界観・出力フォーマット）と日時が入らないこと、可変部の各セクション（値あり／「（なし）」）、日付の `/` が HTML エスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |
| `modelOutput.test.ts` | `src/absenceSimulator/modelOutput.ts` | D-020 の規則ごと: 出来事の件数の過不足・一部不正・種類の置き換え・未知の `threadId`、行動の番号の欠け・重複・範囲外・不正な型・`memo` なし、話題の自動クローズ（14日ちょうど・直前）、LLM による close（未知 id・`"open"` は無視）、新しい話題の上限・空・重複、同時に続く話題の上限超え、前回すでに閉じた話題を引き継がないこと、`EMPTY_MODEL_OUTPUT`・不正な型でのフォールバック、`selectOpenThreadsForPrompt` |
