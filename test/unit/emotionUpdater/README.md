# api/test/unit/emotionUpdater

`src/emotionUpdater/` の単体テスト。対象の概要は [`../../../src/emotionUpdater/README.md`](../../../src/emotionUpdater/README.md) を参照。2026-09-19 に、感情・関係値のモデルの再設計（[D-040](../../../../.notes/decision-history.md#d-040)）に合わせて書き直した。

## 対象と方針

`runEmotionUpdater` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は低いレベルの関数（`getStoredAffectState`・`getRelationshipRecord`・`getLatestAbsenceRecord`・`getRecentLogs`・`saveCharacterAffectState`）だけをモックに差し替えている。状態を読んで時間を進める処理（`lib/affectStateStore.ts`・`lib/affect/`）は本物をそのまま使い、セッションの確定などの組み合わせの動きを実際のコードで確かめる。現在時刻はリクエストの `now` で固定する。`prompt.test.ts` はモックを使わない純粋な関数のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/emotionUpdater/index.ts` | process=1 で記録なし → LLM を呼ばず、時間を進めた状態だけを保存すること、process=1・2 の入力文、直近の会話から今回の発言以降を除くこと、LLM の応答が壊れている・空 → 時間の変化だけで保存されること、評価から情動と気分が動くこと、process=2 で孤独感が減り、関係値の寄与がセッションの途中経過（`pendingSession`）に入ること、**関係値が発言では変わらないこと**、前の発言から30分以上あいていれば前のセッションが確定してから新しいセッションが始まること、process=1 では途中経過に足さないこと、検証の警告が `console.warn` に出ること、保存の内容、レスポンスの形 |
| `prompt.test.ts` | `src/emotionUpdater/prompt.ts` | 固定部が process・状態・入力によらず同じ文字列であること（キャッシュの前提）、固定部に目標（`goals`）が入る・無ければ「（特になし）」、可変部に今の状態・段階の説明・最近の会話（空なら節が出ない）・入力・process ごとの注意が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |

## 見つかった疑わしい挙動と対応

- 以前は、モデルの差分（`moodDelta`/`perceptionDelta`）が数値でないと、文字列連結や `NaN` になっていた（[F-019](../../../../.notes/followup/F-019.md)。2026-09-19 に修正、[D-037](../../../../.notes/decision-history.md#d-037)）。D-040 で LLM の出力が出来事の評価に変わったあとも、同じ考え方（不正な値は無視して警告を残す。例外にしない）を `src/lib/affect/appraisal.ts` が引き継いでいて、[`../lib/affect/`](../lib/affect/README.md) の `appraisal.test.ts` で確かめている。
