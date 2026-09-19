# api/test/unit/emotionUpdater

`src/emotionUpdater/` の単体テスト。対象の概要は [`../../../src/emotionUpdater/README.md`](../../../src/emotionUpdater/README.md) を参照。

## 対象と方針

`runEmotionUpdater` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は `vi.importActual` で `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を本物のまま残しつつ `getCharacterState`/`saveCharacterState`/`getLatestAbsenceRecord` をモックに差し替えている。`prompt.test.ts` はモックを使わない純粋な描画のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/emotionUpdater/index.ts` | 差分適用と 1〜100 へのクランプ（範囲内・上限・下限・四捨五入）、差分に含まれない項目は現在値のまま、`moodDelta`/`perceptionDelta` 自体が無い・fallback時は現在値のまま、DynamoDB に状態が無い場合（`getCharacterState` のモックが `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を返す形で再現）、`saveCharacterState` への保存内容、process1（最新の不在期間の記録。記録が無ければモデルも保存も呼ばず現在の状態を返す、記録の出来事と世界観のタイムゾーン表記の行動が入る、「±0〜3」ルール）と process2（プレイヤー発言、「±1〜5」ルール、記録を読まない）でのプロンプトの違い、`invokeModelJson` に2層の配列が渡ること、mood/perception のラベル・段階の境界値（20/21, 60/61）、モデルの差分が数値でない場合（F-019。数字の文字列・`null`・`NaN`・`Infinity`・オブジェクトは変化なしで `console.warn` が呼ばれる、省略では呼ばれない、同じ差分の中の正しい数値は適用される、応答全体が `null`・`moodDelta` が配列や文字列でも例外にならない、保存値に `NaN` が混ざらない） |
| `prompt.test.ts` | `src/emotionUpdater/prompt.ts` | 固定部が process・感情・入力によらず同じ文字列で、入力や感情を含まないこと（キャッシュの前提）、可変部に現在の値・入力・process ごとの関係値のルール・念押しの一文が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |

## 見つかった疑わしい挙動と対応

- モデルの差分（`moodDelta`/`perceptionDelta`）が数値でないと、文字列連結（`35 + "5"` → `"355"` → 100）や `NaN` になっていた（[F-019](../../../../.notes/followup/F-019.md)）。2026-09-19 に `src/` を直し、「モデルの差分が数値でない場合（F-019）」の `describe` を期待する挙動（変化なし）に書き換えた。
