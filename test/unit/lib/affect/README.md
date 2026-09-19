# api/test/unit/lib/affect

`src/lib/affect/`（感情・関係値のモデルの計算。[D-040](../../../../../.notes/decision-history.md#d-040)）の単体テスト。対象の仕様は [`../../../../src/lib/affect/README.md`](../../../../src/lib/affect/README.md) を参照。

## 方針

どれも LLM も DB も使わない純粋な関数なので、モックは使わない。現在時刻・経過時間は引数で固定する。キャラクターごとの設定（`AffectProfile`）・段階・生活様式は、テストファイルの中のヘルパーで小さく作る（本物の `content/` を読むのは `perceptionGrowthSimulation.test.ts` の1件だけ）。設定値（`affectConfig.ts`）に依存する期待値は、数値を直書きせず `DEFAULT_AFFECT_CONFIG` から計算するか、差し替えた設定で確かめる（設定値を調整してもテストが壊れないように）。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `personality.test.ts` | `personality.ts` | 性格 → 気分の平常値（式の各係数、`neuroticism` の符号、範囲）、感じやすさの倍率と下限、`affectTuning` の上書き、既定値 |
| `appraisal.test.ts` | `appraisal.ts` | LLM の出力の検証（壊れた形・範囲外・不正な値で例外にならず、警告を返す）、OCC の表の各行、強さの式 |
| `emotionDynamics.test.ts` | `emotionDynamics.ts` | 半減期での減衰、加算と範囲、活動中の情動のしきい値と並び順 |
| `moodDynamics.test.ts` | `moodDynamics.ts` | 欲求による平常値のずれ、平常値への回帰、情動による押し引き（引く: 中心の点に向かい通り越さない・直交する成分も寄る／押す: 外側にいるとさらに外へ）、8象限と強さのラベル |
| `needs.test.ts` | `needs.ts` | 疲労（枠の率 × 時間、枠ごとに 0〜100、平日・休日、日をまたぐ枠が期間の開始で切り詰められた場合）、孤独感（段階・`dependence`・愛着のスタイルの係数、上限、発言での減少） |
| `perceptionDynamics.test.ts` | `perceptionDynamics.ts` | 発言1回ぶんの寄与（軸ごとの原因）、段階の下端、差分の適用（全体の倍率、上限に近づくほど単調に上がりづらくなる、上限で止まる、上限を超えている値は削らない、負の重みと下端の手前での減衰、小数のまま返る）、familiarity の減衰 |
| `sessionAccumulator.test.ts` | `sessionAccumulator.ts` | 途中経過への足し込み（ピークは絶対値が大きいほう、最後は上書き）、セッションの終わりの判定、確定は (peak + last) / 2 |
| `affectProjection.test.ts` | `affectProjection.ts` | 初期状態、古い形からの引き継ぎ、状態を `now` まで進める処理（終わったセッションの確定、情動・気分・欲求・familiarity の時間の変化、段階の下端、同じ入力なら同じ結果） |
| `affectText.test.ts` | `affectText.ts` | 気分（8象限と「ふつう」、強さ3段階）・活動中の情動・欲求の文章とラベルの境目、四捨五入、愛着のスタイルごとの再会の説明 |
| `perceptionGrowthSimulation.test.ts` | `perceptionGrowthSimulation.ts` | 各段階に上がる日の計算（関係値の条件と履歴の条件の遅いほう）、打ち切り、倍率・回数の効き。**本物のゆいと既定の設定値で、最後の段階に上がるのが 75〜100 日目に入ること**（ペースの目安「毎日話して約3か月」から外れたら気づくための確認。落ちたら、直近に変えた `affectConfig.ts` の `perception` か `yui.json` の `maxPerception`・`promoteWhen` を見直す） |
