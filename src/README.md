# src

Lambda 関数（4エンドポイント）のソースコード。全体像は [`../README.md`](../README.md) を参照。

| パス | 内容 |
|---|---|
| [`handlers/`](handlers/README.md) | Lambda のエントリーポイント（機能ごとに1ファイル） |
| [`absenceSimulator/`](absenceSimulator/README.md) | 不在期間のシミュレーション（出来事・行動・続きの話題の生成と保存。旧 `eventResolver`・`actionPlanner` を統合したもの） |
| [`emotionUpdater/`](emotionUpdater/README.md) | 感情値・関係値の更新 |
| [`memoryRetriever/`](memoryRetriever/README.md) | 重要記憶の判定と保存 |
| [`dialogueGenerator/`](dialogueGenerator/README.md) | キャラクターのセリフ生成 |
| [`testerCharacters/`](testerCharacters/README.md) | テスターごとのキャラクターの一覧・作成（`GET`/`POST /characters`。tester-character-ownership-roadmap フェーズ3） |
| [`debugCharacterState/`](debugCharacterState/README.md) | mood/perception の読み取り・書き換え（`POST /debug-character-state`。デバッグ専用で stg にだけ作る。D-038） |
| [`promptPartials/`](promptPartials/README.md) | 各機能のテンプレートで共有するパーシャル（世界観・口調の例文） |
| [`lib/`](lib/README.md) | Bedrock / DynamoDB / パッケージ読み込みなどの共有処理 |
| `types.ts` | 型定義（パッケージ・リクエスト・DynamoDB アイテムなど） |
| `mustache.d.ts` | `.mustache` を文字列として import するための型宣言 |
