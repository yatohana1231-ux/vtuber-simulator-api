# baseline

AI 応答テストの基準（採用中のモデル・プロンプトでの集計）。`npm run test:ai -- --compare-to-baseline` で、今回の結果と `summary.json` を比べた表をレポートに足す。`--save-baseline` で今回の集計に置き換える。

## 今の基準

- `summary.json`: 2026-09-19 の比較（ロードマップのフェーズ6）。5モデル（Nova Lite・Nova 2 Lite・Nova Pro・Claude Haiku 4.5・Claude Sonnet 4.6）× 27シナリオ × 3回。採点は暫定の Claude Sonnet 4.6。
- 採用しているモデル（`.notes/decision-history.md` の D-024）: absenceSimulator・dialogueGenerator は Claude Haiku 4.5、emotionUpdater は Nova Lite、memoryRetriever は Nova 2 Lite。比較のときは、この組み合わせの行を見る。

## 取り直すとき

- 採点用のモデルや評価基準（`../rubrics/`）を変えたとき（変える前後の点数は比べられない）。予定: Claude Opus 5 の利用手続きが済んだら、採点を Opus 5 にして取り直す。
- 採用するモデルやプロンプトを変えたとき（変えたあとの結果を確かめてから基準にする）。
