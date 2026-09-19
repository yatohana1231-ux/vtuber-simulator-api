# absenceSimulator

不在期間のシミュレーション。旧 `eventResolver`（出来事の生成）と `actionPlanner`（行動履歴の生成）を統合するモジュールで、骨格（生活リズム・出来事の種類・続きの話題）をサーバーが決め、内容を LLM が書く。方針は [`.notes/absence-simulation-roadmap.md`](../../../.notes/absence-simulation-roadmap.md)、骨格の生成規則は [`.notes/decision-history.md`](../../../.notes/decision-history.md) の D-018。

エンドポイントは `POST /absence-simulator`（ハンドラーは [`../handlers/absenceSimulator.ts`](../handlers/README.md)。2026-09-19 に旧 `/event-resolver`・`/action-planner` と差し替え）。後段（`emotionUpdater`・`memoryRetriever`・`dialogueGenerator`）が保存した記録を読むようにする変更は、ロードマップのフェーズ6で行う（それまでは後段は旧形式の `events`/`actions` をリクエストで受け取る）。記録の保存・読み出しは [`../lib/dynamo.ts`](../lib/README.md) にある。

| ファイル | 内容 |
|---|---|
| `index.ts` | `runAbsenceSimulator(req)` — 本体。骨格を作る → 最新の記録（続きの話題）・直近3件の記録（`RECENT_ABSENCE_RECORD_COUNT`、出来事の要約を「繰り返さない」ために渡す）・重要記憶を並行して読む → プロンプトの層を組み立てる → LLM を1回呼ぶ（最大 `MAX_OUTPUT_TOKENS` = 4000 トークン）→ 骨格と突き合わせて記録を組み立てる → 保存する → `{ startDatetime, endDatetime, events: [{ kind, summary, detail }], actions }` を返す（`threadId`・`threads` はレスポンスに含めない）。Bedrock の例外・JSON のパース失敗は `EMPTY_MODEL_OUTPUT` にフォールバックして記録を保存する。DynamoDB の例外は捕まえない（ハンドラーで 500）。記録の `createdAt` はサーバーの現在時刻 |
| `skeleton.ts` | `buildAbsenceSkeleton({ lifestyle, timeZone, lastLoginAt, now })` — 不在期間の骨格（`AbsenceSkeleton`: 期間・行動の枠・出来事の種類）を組み立てる。行動の枠は今回ログインまでの直近12時間（`MAX_ACTION_WINDOW_HOURS`）が上限、出来事の件数は不在期間全体で決める。`now` が `lastLoginAt` より前なら経過時間0として扱う（入力の検証はハンドラーで行う予定） |
| `actionSlots.ts` | `buildActionSlots({ lifestyle, timeZone, windowStart, windowEnd })` — 生活様式の平日・休日の生活リズムを現地の暦日ごとに展開し、期間に重なる行動の枠（`ActionSlot[]`、時刻は ISO8601 UTC）を返す。日をまたぐ枠が翌日の枠と重なる場合は後の枠を優先して切り詰め、期間の端で15分（`MIN_SLOT_MINUTES`）未満になった枠は捨てる |
| `prompt.ts` | `buildAbsenceSimulatorPromptLayers(input)` — システムプロンプトを層ごとの配列 `[固定部, 可変部]` で返す（プロンプトキャッシュのため。D-017・D-020）。固定部は同じパッケージなら毎回まったく同じ文字列（日時・件数を入れない）。可変部は不在期間・行動の枠・出来事の種類・続いている話題・最近の出来事・重要な記憶で、日時は世界観のタイムゾーンの表記（`2026/09/18(金) 07:00`） |
| [`prompts/`](prompts/README.md)（`absenceSimulator.fixed.mustache` / `absenceSimulator.variable.mustache`） | 固定部・可変部のテンプレート。固定部の「書き方のルール」は出来事・行動・続いている話題・全体に分けて書き、可変部の末尾でルールと出力形式を守るよう念を押す（2026-09-19 に stg のモデルで試した結果をもとに調整。ロードマップの「状態」）。特定の世界観・キャラクターに依存する文面は書かない。差し込みはすべて `{{{ }}}`（HTML エスケープしない） |
| `modelOutput.ts` | `buildAbsenceRecord(...)` — LLM の出力（`AbsenceSimulatorModelOutput`。値は信用せず検証する）と骨格・前回の続いている話題から、保存する記録（`AbsenceRecord`）を組み立てる。出来事は正しい形の要素だけを骨格の件数まで採り、種類は骨格の値にそろえる。行動は番号で骨格の枠と突き合わせ、無い枠は生活リズムの文面にする。続きの話題は14日で自動で閉じ、LLM の `threadUpdates` で閉じ、新しい話題は1回2件まで、同時に続くのは3件まで（`MAX_OPEN_THREADS` など）。`selectOpenThreadsForPrompt` — プロンプトに渡す続いている話題を同じ規則で選ぶ。`EMPTY_MODEL_OUTPUT` — LLM が失敗したときの fallback。規則は D-020 |
| `eventKindSelection.ts` | `countEvents(elapsedMs)` — 不在時間から出来事の件数（`1 + floor(時間 / 12)` を 1〜5 件、0以下なら0件）。`pickEventKinds(eventKinds, count)` — 生活様式の `eventKinds` から重み付きで count 件抽選する（重複あり） |

時刻の変換は [`../lib/timezone.ts`](../lib/README.md)、重み付き抽選は [`../lib/random.ts`](../lib/README.md) を使う。乱数は `Math.random` で、テストでは `vi.spyOn(Math, "random")` で固定する。
