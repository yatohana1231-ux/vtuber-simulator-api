# absenceSimulator

不在期間のシミュレーション。旧 `eventResolver`（出来事の生成）と `actionPlanner`（行動履歴の生成）を統合するモジュールで、骨格（生活リズム・出来事の種類・続きの話題）をサーバーが決め、内容を LLM が書く。方針は [`.notes/absence-simulation-roadmap.md`](../../../.notes/absence-simulation-roadmap.md)、骨格の生成規則は [`.notes/decision-history.md`](../../../.notes/decision-history.md) の D-018。

**実装途中。** 2026-09-18 時点ではフェーズ2（骨格）までで、エンドポイント（`/absence-simulator`）・LLM による肉付け・記録の保存はまだ無い。ランタイムからはどこからも呼ばれていない。

| ファイル | 内容 |
|---|---|
| `skeleton.ts` | `buildAbsenceSkeleton({ lifestyle, timeZone, lastLoginAt, now })` — 不在期間の骨格（`AbsenceSkeleton`: 期間・行動の枠・出来事の種類）を組み立てる。行動の枠は今回ログインまでの直近12時間（`MAX_ACTION_WINDOW_HOURS`）が上限、出来事の件数は不在期間全体で決める。`now` が `lastLoginAt` より前なら経過時間0として扱う（入力の検証はハンドラーで行う予定） |
| `actionSlots.ts` | `buildActionSlots({ lifestyle, timeZone, windowStart, windowEnd })` — 生活様式の平日・休日の生活リズムを現地の暦日ごとに展開し、期間に重なる行動の枠（`ActionSlot[]`、時刻は ISO8601 UTC）を返す。日をまたぐ枠が翌日の枠と重なる場合は後の枠を優先して切り詰め、期間の端で15分（`MIN_SLOT_MINUTES`）未満になった枠は捨てる |
| `eventKindSelection.ts` | `countEvents(elapsedMs)` — 不在時間から出来事の件数（`1 + floor(時間 / 12)` を 1〜5 件、0以下なら0件）。`pickEventKinds(eventKinds, count)` — 生活様式の `eventKinds` から重み付きで count 件抽選する（重複あり） |

時刻の変換は [`../lib/timezone.ts`](../lib/README.md)、重み付き抽選は [`../lib/random.ts`](../lib/README.md) を使う。乱数は `Math.random` で、テストでは `vi.spyOn(Math, "random")` で固定する。
