# Lambda テストイベント

各JSONファイルを AWS コンソール > Lambda > テスト のイベントJSONに貼り付けて使用する。
または AWS CLI で実行する。

## ファイル一覧

| ファイル | テスト対象 | 説明 |
|---------|-----------|------|
| `process1-1.json` | eventResolver→actionPlanner→emotionUpdater→memoryRetriever→dialogueGenerator | 3時間以上2週間未満の不在（7時間） |
| `process1-2-longAbsence.json` | 同上 + longTimeFlag=1 | 2週間以上の不在（17日間） |
| `process1-3-shortInterval.json` | processChat 固定返却 | 3時間未満の不在（1時間）→「こんにちは」が返る |
| `process2-chat.json` | dialogueGenerator→emotionUpdater→memoryRetriever | プレイヤー発言あり（応答生成） |

## AWS CLI でのテスト実行

```powershell
# プロセス1-1（世界シミュレーション・通常不在）
aws lambda invoke --function-name vtuber-simu-chat-stg --payload fileb://test/events/process1-1.json --cli-binary-format raw-in-base64-out response.json; Get-Content response.json

# プロセス1-2（世界シミュレーション・長期不在）
aws lambda invoke --function-name vtuber-simu-chat-stg --payload fileb://test/events/process1-2-longAbsence.json --cli-binary-format raw-in-base64-out response.json; Get-Content response.json

# プロセス1-3（短時間ログイン→固定返却）
aws lambda invoke --function-name vtuber-simu-chat-stg --payload fileb://test/events/process1-3-shortInterval.json --cli-binary-format raw-in-base64-out response.json; Get-Content response.json

# プロセス2（応答生成）
aws lambda invoke --function-name vtuber-simu-chat-stg --payload fileb://test/events/process2-chat.json --cli-binary-format raw-in-base64-out response.json; Get-Content response.json
```

## 各処理の単体テスト

現在のハンドラーは processChat 経由で各処理を呼ぶため、
完全な単体テストは上記イベントの経過時間・メッセージを変えることで各処理の発動を制御する。

- `message=""` → プロセス1（世界シミュレーション）
  - `elapsed >= 336h` → プロセス1-2（longTimeFlag付き）
  - `3h <= elapsed < 336h` → プロセス1-1
  - `elapsed < 3h` → プロセス1-3（固定返却、Bedrock 呼ばない）
- `message` に内容あり → プロセス2（応答生成）
  - dialogueGenerator → emotionUpdater → memoryRetriever の順

## 注意事項

- テストイベントの `characterId` は全て同じ UUID を使っている
- DynamoDB にデータが蓄積されるため、テスト後にクリーンアップが必要な場合がある
- Bedrock の呼び出しに実コストが発生する
