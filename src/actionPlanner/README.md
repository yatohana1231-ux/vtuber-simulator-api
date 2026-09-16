# actionPlanner

`eventResolver` の出来事をもとに、不在期間（上限12時間）のキャラクターの行動履歴を Bedrock で生成する（`POST /action-planner`）。結果は保存せず返すだけ。

| パス | 内容 |
|---|---|
| `index.ts` | `runActionPlanner`。重要記憶（クエリなし、上位8件）を取得してプロンプトを組み立てる |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |
| `template/` | 旧 `enhance-v1` 計画の実験用ファイル（未コミット・ランタイム未使用。`CLAUDE.md` 参照） |
