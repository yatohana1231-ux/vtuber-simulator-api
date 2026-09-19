# dialogueGenerator

感情値・関係値、重要記憶、直近の会話、最新の不在期間の記録（出来事・行動・続いている話題）を踏まえて、キャラクターのセリフを Bedrock で生成する（`POST /dialogue-generator`）。プレイヤーの発言とセリフは会話ログに保存する。

| パス | 内容 |
|---|---|
| `index.ts` | `runDialogueGenerator`。重要記憶はプレイヤー発言をクエリにして上位8件を取得。関係の記録（`getRelationshipRecord`）を読み、`lib/relationship.ts` の `advanceRelationship` で進めて、モデルを呼ぶ前に保存する（`saveRelationshipRecord`）。段階が変わった節目は、プレイヤーには伝えず、重要記憶（`memoryType: relationship_milestone`。セリフの生成には使わない）と CloudWatch のログにだけ残す（D-033）。感情・関係値の状態は、常に DynamoDB から読み、リクエストの `now` まで時間を進めた値を使う（[`lib/affectStateStore.ts`](../lib/affectStateStore.ts) の `loadProjectedAffectState`。情動の減衰・気分の回帰・孤独感と疲労・終わったセッションの関係値への確定を含む。D-040。D-032 でリクエストの `mood`/`perception` は廃止）。**状態レコードには書かない**（書くのは `emotionUpdater` だけ）。段階の判定には、進めたあとの関係値を使う。重要記憶は、状態のあとで読み、今の気分の快・不快（`moodPleasure`）を渡して、同じ向きの感情の記憶を思い出しやすくする（気分一致の記憶）。最新の不在期間の記録は会話のたびに `getLatestAbsenceRecord` で読む（D-022。リクエストの `events`/`actions` は廃止） |
| `prompt.ts` | `buildDialogueGeneratorPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, セッション部, 可変部]` で返す。セッション部には今の関係の段階（説明・話し方・口調の例文）と最新の不在期間の記録、可変部には関係の履歴（`lib/relationshipText.ts`）が入る（D-033）。日時は世界観のタイムゾーンの表記。感情（気分・強い情動・欲求）の文章化は `lib/affect/affectText.ts`、関係値の文章化は `lib/characterStateText.ts` を使う（関係値は整数に丸めてから渡す）。再会の【備考】は、孤独感が `REUNION_LONELINESS_THRESHOLD`（40）以上で、プレイヤーの発言が空（ログイン時の挨拶）のときに、キャラクターの愛着のスタイル（`attachmentStyle`）ごとの説明を入れる。リクエストの `longTimeFlag` は受け取るが使わない（D-040） |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

- キャラクターの設定・関係の段階・口調の例文・世界観はパッケージ（`api/content/`）から差し込む。口調の例文を使うのはこの機能だけで、今の段階の例文（無ければキャラクター共通の例文）を使う。
- 感情をプロンプト用の文章にする処理は `emotionUpdater`・`absenceSimulator` と共通で、[`lib/affect/affectText.ts`](../lib/affect/affectText.ts) にある。関係値の文章化は [`lib/characterStateText.ts`](../lib/characterStateText.ts)（A-9）。
