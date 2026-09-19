# api/test/unit/emotionUpdater

`src/emotionUpdater/` の単体テスト。対象の概要は [`../../../src/emotionUpdater/README.md`](../../../src/emotionUpdater/README.md) を参照。

## 対象と方針

`runEmotionUpdater` が唯一の公開関数。`../../../src/lib/bedrock.js`（`invokeModelJson`）は `vi.mock()` で丸ごと差し替え、`../../../src/lib/dynamo.js` は `vi.importActual` で `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を本物のまま残しつつ `getCharacterState`/`saveCharacterState`/`getLatestAbsenceRecord` をモックに差し替えている。`prompt.test.ts` はモックを使わない純粋な描画のテスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/emotionUpdater/index.ts` | 差分適用と 1〜100 へのクランプ（範囲内・上限・下限・四捨五入）、差分に含まれない項目は現在値のまま、`moodDelta`/`perceptionDelta` 自体が無い・fallback時は現在値のまま、DynamoDB に状態が無い場合（`getCharacterState` のモックが `DEFAULT_MOOD`/`DEFAULT_PERCEPTION` を返す形で再現）、`saveCharacterState` への保存内容、process1（最新の不在期間の記録。記録が無ければモデルも保存も呼ばず現在の状態を返す、記録の出来事と世界観のタイムゾーン表記の行動が入る、「±0〜3」ルール）と process2（プレイヤー発言、「±1〜5」ルール、記録を読まない）でのプロンプトの違い、`invokeModelJson` に2層の配列が渡ること、mood/perception のラベル・段階の境界値（20/21, 60/61） |
| `prompt.test.ts` | `src/emotionUpdater/prompt.ts` | 固定部が process・感情・入力によらず同じ文字列で、入力や感情を含まないこと（キャッシュの前提）、可変部に現在の値・入力・process ごとの関係値のルール・念押しの一文が入ること、`/` がエスケープされないこと、テンプレートに特定の世界観の語が直書きされていないこと |

## 見つかった疑わしい挙動（`src/` は未修正）

`moodDelta`/`perceptionDelta` の各値は型上 `number` だが、`invokeModelJson<T>` は Bedrock の JSON 出力をそのまま `T` として返すだけで実行時の型チェックを行わない。差分の適用は `clamp((current[key] ?? DEFAULT) + (delta[key] ?? 0))` という単純な加算なので、モデルが数値以外を返すと次のような意図しない値になる（「現状の挙動の確認」の `describe` に確認用のテストを残している）。

- **数字の文字列（例: `"5"`）** → `+` 演算子が文字列連結になる（`35 + "5"` → `"355"`）。`Math.round("355")` は `355` になり、最終的に上限クランプで `100` になる。本来期待される `40` にはならない。
- **マイナスを表す文字列（例: `"-5"`）** → `35 + "-5"` は `"35-5"` という文字列になり、`Math.round` が内部で行う `Number("35-5")` は `NaN` になる。結果、その項目は `NaN` のまま保存される（DynamoDB へ保存される値としても不正）。
- **`null`** → 加算時に `0` として扱われるため、たまたま「変化なし」になる（実害は目立たないが、意図した差分が無視されている）。

詳細は作業報告（呼び出し元へのハンドバック）を参照。
