# emotionUpdater

キャラクターの感情（情動・気分・欲求）と関係値を更新して DynamoDB に保存する（`POST /emotion-updater`）。**LLM には出来事の評価（分類）だけをさせ、数値の計算はすべて [`lib/affect/`](../lib/affect/README.md) の純粋な関数で行う**（[D-040](../../../.notes/decision-history.md#d-040)。経緯は [`.notes/affect-model-redesign-roadmap.md`](../../../.notes/affect-model-redesign-roadmap.md)）。

| パス | 内容 |
|---|---|
| `index.ts` | `runEmotionUpdater`。下の「処理の流れ」のとおり |
| `prompt.ts` | `buildEmotionUpdaterPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（D-017・D-022）。固定部にはキャラクターの目標（`character.goals`）と、評価の項目の説明が入る |
| [`prompts/`](prompts/README.md) | システムプロンプトのテンプレート |

## 処理の流れ

1. [`lib/affectStateStore.ts`](../lib/affectStateStore.ts) の `loadProjectedAffectState` で、状態レコードを読んでリクエストの `now` まで時間を進める（情動の減衰、気分の平常値への回帰、孤独感・疲労、終わったセッションの関係値への確定）。今の関係の段階は、関係の記録（`index = "relationship"`）から読む。
2. 入力を作る。process=1 は最新の不在期間の記録（`getLatestAbsenceRecord`。D-022。**記録が無ければ LLM を呼ばず、時間を進めた状態だけを保存して返す**）。process=2 はプレイヤーの発言と、直近の会話のうち今回の発言より前のぶん（`getRecentLogs`。キャラクターの直前のセリフにプレイヤーがどう応じたかを判定するため。`/dialogue-generator` が先に今回のやり取りをログに残しているので、今回の発言以降を除く）。
3. LLM の出力（`appraisals`: 出来事の評価、最大3件。`interaction`: プレイヤーとのやり取りの分類、process=2 だけ）を `parseEmotionUpdaterModelOutput` で検証する。不正な値は無視して `console.warn` に残し、例外にしない（D-037 と同じ考え方）。
4. 評価 → 情動への加算（OCC の表。`appraisalsToEmotionImpulses`）→ 情動に足す → 情動が気分を押し引きする（`applyPullPush`）。
5. process=2 だけ: 孤独感を減らし、発言1回ぶんの関係値の寄与（`computeMessageContribution`）をセッションの途中経過（`pendingSession`）に足す。**関係値そのものは、ここでは変えない。** セッションが終わったあと（前の発言から30分以上あいたあと）の 1 の処理で、ピーク・エンドの平均が1回だけ反映される。
6. `saveCharacterAffectState` で保存し、`{ emotions, mood, needs, perception }` を返す。評価の要約・起きた情動・更新後の気分をログに出す。

- 状態レコードに書くのは、この機能とデバッグ用のエンドポイント（[`../debugCharacterState/`](../debugCharacterState/README.md)）だけ。`dialogueGenerator` は読むだけ。
- process=1 の入力文は `lib/absenceRecordText.ts` の `formatAbsenceRecordAsInputText` で作る（`memoryRetriever` と共通）。
- Lambda の権限: キャラクター記憶テーブルの読み書きと、会話ログテーブルの `Query` だけ（`infra/lib/vtuber-simulator-stack.ts`）。
