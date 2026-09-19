# prompts（emotionUpdater）

システムプロンプトは、プロンプトキャッシュのため固定部と可変部の2つのテンプレートに分けている（D-017・D-022）。`../prompt.ts` がこの順に描画する。LLM には数値を出させず、出来事の評価とやり取りの分類だけを出させる（[D-040](../../../../.notes/decision-history.md#d-040)）。

| ファイル | 層 | 内容 |
|---|---|---|
| `emotionUpdater.fixed.mustache` | ① 固定部 | 役割、キャラクター情報（名前・性格・設定）、共有パーシャル `{{> world}}`、キャラクターの目標（`goals`。無ければ「（特になし）」）、出来事の評価（`appraisals`）の項目と点数の目安、やり取りの分類（`interaction`）の項目、JSON 出力形式。同じパッケージなら process・状態によらず毎回まったく同じ文字列 |
| `emotionUpdater.variable.mustache` | ③ 可変部 | キャラクターの今の状態（気分・活動中の情動・欲求。`lib/affect/affectText.ts`）、今の関係の段階の説明、最近の会話（process=2 で、あるときだけ）、評価する入力、process ごとの注意、出力の形式を守るよう促す一文 |

- 特定の世界観・キャラクターに依存する文面は書かない。差し込みはすべて `{{{ }}}`（HTML エスケープしない。F-014）。
- 評価の項目（`desirabilityForSelf`・`prospect`・`cause` など）の意味は、`lib/affect/appraisal.ts` の OCC の表と対になっている。項目や選択肢を変えるときは両方を直し、AI 応答テストで確かめる。
