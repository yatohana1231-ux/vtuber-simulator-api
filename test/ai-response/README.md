# api/test/ai-response

AI 応答テスト（AI の出力の質を確かめ、モデルやプロンプトを比べるテスト）の実装。考え方は [`../../../test/test_ai_response/README.md`](../../../test/test_ai_response/README.md) を参照。

**整備中（2026-09-19〜）。** `.notes/model-selection-roadmap.md` のフェーズ3で仕組み（実行・判定・集計・レポート）、フェーズ4でシナリオ（4機能・計27件）と評価基準を作った。LLM による採点（フェーズ5）はこれから。

## 実行

`api/` で実行する。Bedrock を実際に呼ぶので料金がかかる（DynamoDB はメモリ上の偽物で、AWS にはつながない）。stg 用の AWS 認証情報が要る。

```
npm run test:ai -- --dry-run                                   # 計画と料金の見積もりだけ（Bedrock を呼ばない）
npm run test:ai -- --models nova-lite,claude-haiku-4-5 --repeat 3
npm run test:ai -- --functions dialogueGenerator --scenarios <id>,<id>
npm run test:ai -- --compare-to-baseline                       # 基準（baseline/summary.json）との比較をレポートに足す
npm run test:ai -- --save-baseline                             # 今回の集計を基準として保存する
```

| 引数 | 既定値 | 内容 |
|---|---|---|
| `--functions` | 全4機能 | 対象の機能（カンマ区切り） |
| `--models` | `nova-lite` | `models.json` のキー（カンマ区切り） |
| `--scenarios` | すべて | シナリオの id で絞り込む |
| `--repeat` | 3 | 同じ入力の繰り返し回数 |
| `--concurrency` | 3 | 同じモデルの中で同時に走らせる数（モデルは環境変数で切り替えるため、違うモデルは同時に走らせない） |
| `--max-cost` | 5（USD） | 見積もりがこれを超えたら実行しない（終了コード 2）。実行中も実際の料金がこれを超えたら残りを打ち切る |
| `--out` | `results/<タイムスタンプ>` | 結果の保存先 |

結果（`--out`）: `runs.jsonl`（1回の実行ごとの結果。出力・Bedrock の呼び出し〔プロンプト・応答・使用量〕・DynamoDB への書き込み・判定）、`summary.json`（機能 × モデルの集計）、`report.md`（比較レポート）。

## 仕組み

`run.mjs` が `runner/cli.ts` を esbuild でバンドル（`.mustache` をテキストとして読むため）してから実行する。

1. `scenarios/<機能名>/<id>.json` を読み、日時の相対指定（`now-30h` など）を実行開始時刻で解決する
2. 計画（シナリオ × モデル × 繰り返し）と料金の見積もり（`estimates.json` の想定トークン数 × `pricing.json` の単価）を出す
3. `src/lib/dynamo.ts` の `dynamo.send` をメモリ上の偽物に差し替え、シナリオの状態を入れる。Bedrock の呼び出しは記録するだけで、そのまま本物に送る
4. モデルごとに、環境変数 `BEDROCK_MODEL_ID` を切り替えて各機能の本番の `run*` を呼ぶ
5. ルールで判定し（`runner/checks/`）、集計してレポートを書く（`runner/report.ts`）

| パス | 内容 |
|---|---|
| `run.mjs` | 入口（`npm run test:ai`）。バンドルして実行する。バンドルは `.build/`（git 管理外） |
| `runner/types.ts` | シナリオ・実行の結果・集計の型（部品どうしはこの型だけでつながる） |
| `runner/cli.ts` | 引数の解釈、計画・見積もり・上限、実行の順番、保存 |
| `runner/scenarios.ts` | シナリオの読み込みと形の検証、日時の相対指定の解決 |
| `runner/fakeDynamo.ts` | メモリ上の偽の DynamoDB（`dynamo.ts` が使う Get・Put・Query・Update・TransactWrite だけに対応。それ以外は例外） |
| `runner/bedrockRecorder.ts` | Bedrock の呼び出し（プロンプト・応答・使用量・所要時間）の記録。並行実行でも実行ごとに分ける |
| `runner/execute.ts` | 1回の実行（パッケージの読み込み、状態の投入、リクエストの組み立て、`run*` の呼び出し） |
| `runner/cost.ts` | 料金の計算と見積もり |
| `runner/checks/` | ルールによる判定（機能ごとのファイル。判定の種類は下の表） |
| `runner/report.ts` | 集計、比較レポート（Markdown）、基準との比較 |
| `models.json` | 比較できるモデル（キー → 推論プロファイルの ID・表示名）。足すときはここと `pricing.json` に書く |
| `pricing.json` | モデルごとの料金（100万トークンあたりの USD。確認日と出典付き。手で更新する） |
| `estimates.json` | 見積もりに使う、機能ごとの1回あたりの想定トークン数 |
| `scenarios/` | シナリオ（`<機能名>/<id>.json`。id は機能の中で一意）。下の「シナリオの一覧」を参照 |
| `rubrics/` | LLM による採点の評価基準（`<機能名>.md`。書式は [`rubrics/README.md`](rubrics/README.md)） |
| `baseline/` | 基準の集計（`--save-baseline` で作る。git に残す） |
| `results/` | 実行ごとの結果（git 管理外） |

## 判定の種類（シナリオの `checks` に `{ "type": ..., "params": ... }` で書く）

| 機能 | type | params | 合格の条件 |
|---|---|---|---|
| 共通 | `modelResponded` | — | Bedrock の呼び出しがあり、例外が無い |
| 共通 | `jsonParsed` | — | 最後の応答から JSON が読めた（`invokeModelJson` と同じ抽出方法） |
| 共通 | `noModelCall` | — | Bedrock を呼んでいない（呼ばないのが正しいシナリオ用） |
| dialogueGenerator | `maxLength` | `max`（既定 120） | 返答の文字数が上限以下 |
| dialogueGenerator | `noForbiddenElements` | — | 世界観の `forbiddenElements` を含まない |
| dialogueGenerator | `noAiDisclosure` | — | 「AI」「人工知能」「言語モデル」などを含まない（英字は単語の区切りで判定） |
| dialogueGenerator | `mustMentionAny` / `mustNotMention` | `words` | いずれかの語を含む／どの語も含まない |
| dialogueGenerator | `politenessStyle` | `expect`: `casual` / `polite` | 文末の表現で判定した文体がそろっている（簡易な判定） |
| absenceSimulator | `eventCountMatchesSkeleton` | — | 出来事の件数が、不在時間から決まる件数と一致 |
| absenceSimulator | `actionsMatchedByIndex` | — | LLM の出力に、行動の枠の番号がそろっている（生活リズムの文面で補われた枠が無い） |
| absenceSimulator | `slotActionMustNotContain` | `activityIncludes`, `words` | その過ごし方の枠（例: 就寝）の行動に、指定の語（例: 食べ）を含まない |
| absenceSimulator | `noRepeatOfRecentEvents` | `threshold`（既定 0.5） | 最近の記録の出来事と似た出来事が無い（文字 bigram の Jaccard 係数） |
| absenceSimulator | `noDuplicateThreads` | `threshold`（既定 0.5） | 続いている話題どうしが似ていない |
| absenceSimulator | `threadContinued` | `threadTopicIncludes` | その話題の続きの出来事がある |
| emotionUpdater | `deltaDirection` | `expect`（`mood.joy` などの向き: up/down/flat/notDown/notUp） | 変化の向きが期待どおり |
| emotionUpdater | `deltaWithin` | `path`（mood/perception）, `max` | その群の変化の絶対値が上限以下 |
| memoryRetriever | `savedCount` | `min`, `max` | 保存した記憶の件数が範囲内 |
| memoryRetriever | `savedMustMentionAny` / `savedMustNotMention` | `words` | 保存した記憶にいずれかの語を含む／どの語も含まない |

- 特定の世界観・キャラクターに依存する語は、判定のコードではなくシナリオの `params` に書く。
- 類似度・文体の判定は表記に基づく簡易なもの。意味の良し悪しは LLM による採点（フェーズ5）で見る。

## シナリオの一覧（2026-09-19）

パッケージはすべて `yui-modern-tokyo`。各シナリオの `checks`（ルールによる判定）と `judgeFocus`（採点で重視する観点）は JSON を参照。

| 機能 | id | 確かめること |
|---|---|---|
| absenceSimulator | `weekday-night-absence-with-sleep` | 平日の夜〜朝（就寝の枠を含む）。就寝の枠に食事・外出などの行動を書かないか |
| absenceSimulator | `holiday-daytime-outing-and-stream` | 休日の日中（外出・配信の枠） |
| absenceSimulator | `continuing-thread-from-previous-absence` | 続いている話題が2件あるとき、似た話題を重ねないか |
| absenceSimulator | `recent-event-repeat-risk` | 直近の記録と同じ時間帯。最近の出来事を繰り返さないか |
| absenceSimulator | `long-absence-three-days` | 3日の不在（出来事5件） |
| absenceSimulator | `short-absence-three-hours` | 3時間の不在（出来事1件） |
| dialogueGenerator | `first-meeting-greeting` | 初対面。丁寧語で話すか |
| dialogueGenerator | `login-greeting-recent-event` | ログイン直後。不在中の出来事に触れるか |
| dialogueGenerator | `asked-about-this-mornings-event` | 今朝の出来事を聞かれて、記録どおりに答え、「昨日」と言わないか |
| dialogueGenerator | `asked-about-yesterdays-event` | 昨日の出来事を聞かれて、「今朝」と言わないか |
| dialogueGenerator | `continuing-thread-question` | 続いている話題について聞かれたとき |
| dialogueGenerator | `important-memory-movie-promise` | 重要記憶（映画の約束）を踏まえるか |
| dialogueGenerator | `forbidden-world-topic-magic` | 世界観にない話題（魔法・転生）を肯定しないか（採点で見る） |
| dialogueGenerator | `long-absence-return-greeting` | 長期不在の再会（`longTimeFlag: 1`） |
| emotionUpdater | `process2-kind-words` | やさしい発言で喜びが上がり、関係値が下がらないか |
| emotionUpdater | `process2-harsh-words` | 心ない発言で喜びが上がらず、不安が下がらないか |
| emotionUpdater | `process2-neutral-smalltalk` | 中立の雑談で変化が小さいか |
| emotionUpdater | `process1-happy-event` | 嬉しい出来事の記録で、喜びが下がらず関係値の変化が小さいか |
| emotionUpdater | `process1-trouble-event` | トラブルの記録で喜びが上がらないか |
| emotionUpdater | `process1-no-record` | 記録が無ければ LLM を呼ばないか |
| memoryRetriever | `process2-promise-made` | 約束（映画）を覚えるか |
| memoryRetriever | `process2-preference-revealed` | プレイヤーの好み（いちご）を覚えるか |
| memoryRetriever | `process2-smalltalk-only` | あいさつ・相づちだけなら何も覚えないか |
| memoryRetriever | `process2-duplicate-of-existing-memory` | 既存の記憶の言い換えを重ねて覚えないか |
| memoryRetriever | `process2-logs-under-10` | 会話ログが10件未満なら LLM を呼ばないか |
| memoryRetriever | `process1-notable-event` | 不在期間の記録を判定するか |
| memoryRetriever | `process1-no-record` | 記録が無ければ LLM を呼ばないか |

- シナリオを足すときは、仕組みのコードを変えずに JSON を置くだけでよい（形は `runner/types.ts` の `Scenario`、判定は上の「判定の種類」）。実際に見つかった粗さは、再現するシナリオにして残す。
- 曜日・時間帯に意味があるシナリオは絶対時刻（UTC）、そうでないものは相対指定（`now-30h` など）で書く。1つのシナリオの中ではどちらかにそろえる（記憶の新しさや話題の14日の自動クローズは実行時の現在時刻で決まるので、それらの日時は相対指定にする）。

## 単体テスト

`runner/**/*.test.ts`（仕組みそのもののテスト。Bedrock・DynamoDB は使わない）は、`npm test` に含まれる（`vitest.config.ts` の `include`）。
