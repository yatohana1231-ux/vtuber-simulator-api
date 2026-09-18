# src

Lambda 関数（5エンドポイント）のソースコード。全体像は [`../README.md`](../README.md) を参照。

| パス | 内容 |
|---|---|
| [`handlers/`](handlers/README.md) | Lambda のエントリーポイント（機能ごとに1ファイル） |
| [`eventResolver/`](eventResolver/README.md) | 不在期間中の出来事の生成 |
| [`actionPlanner/`](actionPlanner/README.md) | 不在期間中の行動履歴の生成 |
| [`absenceSimulator/`](absenceSimulator/README.md) | 不在期間のシミュレーション（`eventResolver`・`actionPlanner` を統合する予定。実装途中で、まだエンドポイントは無い） |
| [`emotionUpdater/`](emotionUpdater/README.md) | 感情値・関係値の更新 |
| [`memoryRetriever/`](memoryRetriever/README.md) | 重要記憶の判定と保存 |
| [`dialogueGenerator/`](dialogueGenerator/README.md) | キャラクターのセリフ生成 |
| [`promptPartials/`](promptPartials/README.md) | 5つのテンプレートで共有するパーシャル（世界観・口調の例文） |
| [`lib/`](lib/README.md) | Bedrock / DynamoDB / パッケージ読み込みなどの共有処理 |
| `types.ts` | 型定義（パッケージ・リクエスト・DynamoDB アイテムなど） |
| `mustache.d.ts` | `.mustache` を文字列として import するための型宣言 |
