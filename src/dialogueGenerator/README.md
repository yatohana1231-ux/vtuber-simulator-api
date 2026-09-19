# dialogueGenerator

感情値・関係値、重要記憶、直近の会話、最新の不在期間の記録（出来事・行動・続いている話題）を踏まえて、キャラクターのセリフを Bedrock で生成する（`POST /dialogue-generator`）。プレイヤーの発言とセリフは会話ログに保存する。

| パス | 内容 |
|---|---|
| `index.ts` | `runDialogueGenerator`。重要記憶はプレイヤー発言をクエリにして上位8件を取得。関係の記録（`getRelationshipRecord`）を読み、`lib/relationship.ts` の `advanceRelationship` で進めて、モデルを呼ぶ前に保存する（`saveRelationshipRecord`）。段階が変わった節目は、プレイヤーには伝えず、重要記憶（`memoryType: relationship_milestone`。セリフの生成には使わない）と CloudWatch のログにだけ残す（D-033）。mood/perception は常に DynamoDB から取得する（`getCharacterState`。会話ログなどの取得と並行。D-032 でリクエストの `mood`/`perception` は廃止）。最新の不在期間の記録は会話のたびに `getLatestAbsenceRecord` で読む（D-022。リクエストの `events`/`actions` は廃止） |
| `prompt.ts` | `buildDialogueGeneratorPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, セッション部, 可変部]` で返す。セッション部には今の関係の段階（説明・話し方・口調の例文）と最新の不在期間の記録、可変部には関係の履歴（`lib/relationshipText.ts`）が入る（D-033）。日時は世界観のタイムゾーンの表記。mood/perception の文章化は `lib/characterStateText.ts` を使う |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- キャラクターの設定・関係の段階・口調の例文・世界観はパッケージ（`api/content/`）から差し込む。口調の例文を使うのはこの機能だけで、今の段階の例文（無ければキャラクター共通の例文）を使う。
- mood/perception をプロンプト用の文章にする処理は `emotionUpdater` と共通で、[`lib/characterStateText.ts`](../lib/characterStateText.ts) にある（A-9）。
