# lib/affect

感情・関係値のモデル（[D-040](../../../../.notes/decision-history.md#d-040)）の計算。ALMA（Gebhard 2005）を参考に、状態を 情動（短期）・気分（中期）・欲求・関係値 の層に分け、性格（長期）は `content/characters/*.json` に持つ。経緯と設計は [`.notes/affect-model-redesign-roadmap.md`](../../../../.notes/affect-model-redesign-roadmap.md)、理論の出典は [`.notes/mood-perception-model-review.md`](../../../../.notes/mood-perception-model-review.md)。

**考え方**: LLM には分類（何が起きたか）だけをさせ、数値の計算はすべてこのフォルダの純粋な関数で行う（LLM も DB も使わない。現在時刻は引数で受け取る）。数値の設定値は `affectConfig.ts` の `DEFAULT_AFFECT_CONFIG` に集め、どの関数も最後の引数 `config`（省略時は既定値）で受け取る。値は内部では小数のまま持ち、丸めるのは文章にするとき（`affectText.ts`）だけ。引数のオブジェクトは書き換えず、新しいオブジェクトを返す。

型は [`../../types.ts`](../../types.ts) の「感情・関係値のモデル」の節（`Emotions`・`MoodPad`・`Needs`・`CharacterAffectState`・`Appraisal`・`InteractionLabels`・`EmotionImpulse`・`PendingSession` など）。

| ファイル | 内容 |
|---|---|
| `affectConfig.ts` | 設定値の型 `AffectConfig` と既定値 `DEFAULT_AFFECT_CONFIG`、キャラクターごとに解決した設定 `AffectProfile`、軸・情動の一覧（`PERCEPTION_KEYS`・`POSITIVE_EMOTION_KEYS`・`NEGATIVE_EMOTION_KEYS`） |
| `personality.ts` | 性格（`bigFive`・`affectTuning`）→ `AffectProfile` |
| `appraisal.ts` | LLM の出力（出来事の評価）の検証と、OCC の表による情動への変換 |
| `emotionDynamics.ts` | 情動の減衰・加算・活動中の情動 |
| `moodDynamics.ts` | 気分の平常値への回帰、情動による押し引き（ALMA の pull-push）、8象限のラベル |
| `needs.ts` | 疲労（生活様式から計算）・孤独感（会っていない時間から計算） |
| `perceptionDynamics.ts` | 関係値の寄与の計算、段階の上限、釣り鐘の減衰、familiarity の減衰 |
| `sessionAccumulator.ts` | セッション（会話のまとまり）の途中経過と、ピーク・エンドでの確定 |
| `affectProjection.ts` | 保存してある状態を `now` まで進める処理（上の関数の組み合わせ）と、初期状態 |
| `affectText.ts` | 状態をプロンプト用の文章にする |
| `perceptionGrowthSimulation.ts` | 設定値の試算。`simulatePerceptionGrowth(input, config?)` — 1セッションで確定する差分と1日のセッションの回数から、各段階に何日目に上がるか（関係値の条件・履歴の条件のそれぞれを満たした日）を出す。CLI は `npm run simulate:perception -- [--package <id>] [--gain-scale 0.8] [--sigma 0.45] [--sessions-per-day 1]`（AWS は呼ばない）。既定の設定値とゆいで、最後の段階に上がるのが 75〜100 日目に入ることを単体テストで確かめている（ペースの目安は「毎日話して約3か月」。ユーザーの指示） |

## 各ファイルの仕様

### `personality.ts`

`resolveAffectProfile(character: CharacterDefinition, config?): AffectProfile`

- `bigFive` が無ければすべて 0。気分の平常値は Mehrabian（1996）の式（ALMA と同じ）。原典の式の N は情緒安定性（高いほど安定）なので、このプロジェクトの `neuroticism`（高いほど不安定）では符号を反転する:
  - 快 = 0.21E + 0.59A − 0.19N／覚醒 = 0.15O + 0.30A + 0.57N／支配性 = 0.25O + 0.17C + 0.60E − 0.32A（各 −100〜+100 に収める）
  - `affectTuning.moodHomeBase` があれば、式を使わずその値にする。
- `positiveEmotionGain` = (1 + `extraversionPositiveGain` × E/100) × (`affectTuning.positiveEmotionGain` ?? 1)。`negativeEmotionGain` = (1 + `neuroticismNegativeGain` × N/100) × (`affectTuning.negativeEmotionGain` ?? 1)。どちらも下限 0.1。
- ほかの倍率は `affectTuning` の値（無ければ 1）。`perceptionDampingSigma` は `affectTuning` の値（無ければ `config.perception.dampingSigma`）。`goals` は無ければ空、`attachmentStyle` は無ければ `"secure"`。

### `appraisal.ts`

`parseEmotionUpdaterModelOutput(raw: unknown, goals: CharacterGoal[], process: 1 | 2): { appraisals: Appraisal[]; interaction: InteractionLabels | null; warnings: string[] }`

- 例外を投げない（[D-037](../../../../.notes/decision-history.md#d-037) と同じ考え方）。おかしな値は無視して `warnings` に項目名と値を残す。
- `raw` や `raw.appraisals` がオブジェクト・配列でなければ `appraisals` は空。先頭3件だけを使う。
- 数値の項目: 有限の数値なら四捨五入して −3〜+3 に収める。数値でなければ 0 にして警告（項目の省略は 0 で、警告しない）。
- `prospect`・`cause` が決まった値でなければ、その評価を捨てて警告。`summary` が文字列でなければ `""`。`relatedGoalKey` が `goals` に無ければ `null`（`null`・省略でない未知の値は警告）。
- `interaction`: process=2 のときだけ返す（process=1 は `null`）。項目が不正なら既定値（`"none"`・`"not_applicable"`・`false`・`false`）にして警告。`raw.interaction` が無い・オブジェクトでないときは、すべて既定値。

`appraisalsToEmotionImpulses(appraisals, profile: AffectProfile, config?): EmotionImpulse[]`

- 強さ = |点数| × `intensityPerPoint` ×（0.5 + 重要度/100）× 感じやすさ。重要度は `relatedGoalKey` の目標の `importance`（無ければ `defaultGoalImportance`）。感じやすさは、`POSITIVE_EMOTION_KEYS` の情動なら `positiveEmotionGain`、`NEGATIVE_EMOTION_KEYS` なら `negativeEmotionGain`、`sympathy` は 1。
- 自分にとっての望ましさ `desirabilityForSelf`（ds）と `prospect`:
  - `happened`: ds > 0 → joy、ds < 0 → sadness
  - `anticipated`: ds > 0 → hope、ds < 0 → anxiety
  - `avoided` → relief、`missed` → disappointment（点数は max(|ds|, 1)）
- 行いの評価 `praiseworthiness`（pw）。`prospect` が `happened` のときだけ:
  - `cause: self`: pw > 0 → pride、pw < 0 → shame
  - `cause: player`・`other`: pw > 0 → admiration。さらに ds > 0 なら gratitude（点数は |ds|）。pw < 0 → anger（点数は max(|pw|, |ds|)。ds ≥ 0 なら |pw|）
  - `cause: circumstance`: なし
- プレイヤーにとっての望ましさ `desirabilityForPlayer`（dp）: dp > 0 → happyFor、dp < 0 → sympathy。
- `EmotionImpulse.cause`・`summary` は、もとの評価のものを入れる。同じ情動が複数出ても、まとめずに別々に返す。

### `emotionDynamics.ts`

- `createNeutralEmotions(): Emotions` — すべて 0。
- `decayEmotions(emotions, elapsedHours, profile, config?): Emotions` — `値 × 0.5^(経過時間 / (半減期 × emotionHalfLifeScale))`。0.01 未満は 0。`elapsedHours` が 0 以下なら変えない。
- `applyEmotionImpulses(emotions, impulses): Emotions` — 確率的な和（noisy-OR）で合わせる: 今の強さ `e`（0〜100）に強さ `i`（0〜100 に収めてから使う）の加算が来たら `100 × (1 − (1 − e/100) × (1 − i/100))`。複数の加算は順に当てる（積なので順番によらない）。足し算にしない理由: LLM が1つの発言から複数の出来事を取り出しても、同じ情動を何重にも数えないため（2026-09-19 に stg の確認で、ほめ言葉1回で情動が 100 に張り付き、好感の寄与が +13.8 になったのを直した）。
- `getActiveEmotions(emotions, config?): Array<{ emotion: EmotionKey; intensity: number }>` — `activeThreshold` 以上を、強い順に。

### `moodDynamics.ts`

- `computeEffectiveHomeBase(profile, needs, config?): MoodPad` — 平常値を欲求でずらす（覚醒 += `arousalOffsetAtFullFatigue` × fatigue/100、快 += `pleasureOffsetAtFullLoneliness` × loneliness/100）。−100〜+100 に収める。
- `decayMoodTowardHomeBase(mood, homeBase, elapsedHours, profile, config?): MoodPad` — 軸ごとに `平常値 + (値 − 平常値) × 0.5^(経過時間 / (halfLifeHours × moodHalfLifeScale))`。
- `applyPullPush(mood, emotions, config?): MoodPad` — 活動中の情動が無ければ変えない。情動の中心 = 活動中の情動の PAD 座標の、強さで重みを付けた平均。中心の強さ = 活動中の情動の強さの平均。1回の幅 = `pullPushStepAtFullIntensity` × 中心の強さ/100。気分を中心の向き（原点から中心への単位ベクトル）に射影した長さが、中心までの距離以上なら「押す」（中心の向きに幅のぶん動かす）。そうでなければ「引く」（中心に向かって幅のぶん動かす。中心は通り越さない）。中心が原点とほぼ同じなら変えない。−100〜+100 に収める。
- `describeMood(mood, config?): { octant: MoodOctant | "neutral"; strength: "slight" | "moderate" | "strong" }` — 原点からの距離が `neutralRadius` 未満なら `neutral`（`strength` は `slight`）。象限は符号で決める（0 は + とみなす）: `exuberant`(+P+A+D)・`bored`(−P−A−D)・`dependent`(+P+A−D)・`disdainful`(−P−A+D)・`relaxed`(+P−A+D)・`anxious`(−P+A−D)・`docile`(+P−A−D)・`hostile`(−P+A+D)。`MoodOctant` 型はこのファイルで export する。

### `needs.ts`

- `computeFatigue(lifestyle, timeZone, now: Date, config?): number` — 保存した値は使わず、生活様式だけから決める。`now − fatigueLookbackHours` の時点を `fatigueBaseline` として、`buildActionSlots`（`../../absenceSimulator/actionSlots.ts`）で展開した枠を古い順にたどり、`fatigueChangePerHour × 枠の時間` を足していく（枠ごとに 0〜100 に収める）。枠の `fatigueChangePerHour` は、平日・休日の `ScheduleSlot` から `activity` の文字列で引く（同じ文字列が複数あれば先頭。無ければ 0）。
- `projectLoneliness(loneliness, elapsedHours, ctx: { dependence: number; stageIndex: number; stageCount: number; profile: AffectProfile }, config?): number` — 経過時間が `sessionGapMinutes` 未満なら変えない。増える量 = `lonelinessGrowthPerDay` × 経過日数 × 段階の係数 × dependence の係数 × 愛着の係数 × `lonelinessGrowthScale`。段階の係数は、最初の段階が `lonelinessFirstStageFactor`、最後の段階が 1 で、間は直線（段階が1つなら 1）。dependence の係数は 1〜100 を `min`〜`max` に直線で対応。結果は `lonelinessMaxFromAbsence` を超えない（もとの値がすでに超えていれば、もとの値のまま）。
- `relieveLonelinessByMessage(loneliness, config?): number` — `lonelinessReliefPerMessage` を引く（下限 0）。

### `perceptionDynamics.ts`

- `computeMessageContribution(args: { impulses: EmotionImpulse[]; interaction: InteractionLabels | null; stageIndex: number; stageCount: number }, config?): PerceptionContribution` — 発言1回ぶんの寄与（負の重みはここではかけない）。`cause: player` の情動は、合計ではなく**情動の種類ごとに「いちばん強い1件」**（強さは 100 を上限にして使う）にまとめてから使う。理由: LLM が1つの発言から複数の出来事を取り出しても、同じ情動・同じ相手への気持ちを何重にも数えないため（2026-09-19 に stg の確認で、ほめ言葉1回で好感の寄与が +13.8 になったのを直した）。
  - affection: `cause: player` の正の情動の中でいちばん強い1件の強さ − 負の情動の中でいちばん強い1件の強さ（種類をまたいでも最大の1つ）を 100 で割って `affectionPerPlayerCausedEmotion` をかける。どちらも無ければ 0。
  - trust: `responsive` → `trustResponsive`、`dismissive` → `trustDismissive`、`rememberedPastTopic` → `trustRememberedPastTopic`、`cause: player` の gratitude の中でいちばん強い1件の強さ/100 × `trustPerGratitude`。
  - respect: `cause: player` の admiration の中でいちばん強い1件の強さ/100 × `respectPerAdmiration`。
  - fear: `cause: player` の anger・sadness の中でいちばん強い1件の強さが `fearNegativeEmotionThreshold` 以上なら、その強さ/100 × `fearPerPlayerCausedNegativeEmotion`。それが無く、`cause: player` の正の情動があれば `fearReliefPerPositiveMessage`。
  - dependence: `helpedCharacter` なら `dependenceHelped` × 段階の係数（最初の段階が `dependenceFirstStageFactor`、最後が 1）。
  - familiarity: `interaction` があれば `familiarityPerMessage` ＋ 開示のぶん（`fact`・`emotion`）。`interaction` が `null` なら 0。
- `resolveStageBase(base: PerceptionStageBase | null, stageKey: string, perception: Perception): PerceptionStageBase` — `base` が無いか段階が違えば、今の関係値で作り直す。同じなら `base` のまま。
- `applyPerceptionDelta(args: { perception: Perception; delta: PerceptionContribution; stage: RelationshipStage; stageBase: Perception; profile: AffectProfile }, config?): Perception` — 軸ごとに:
  - 差分が正: 上限 = `stage.maxPerception` のその軸（無ければ 100）。今の値が上限以上なら変えない（**上限を超えている値は削らない**）。位置 `p = (今の値 − 下端) / (上限 − 下端)` を 0〜1 に収める（下端は `stageBase` のその軸。上限 ≤ 下端なら p = 1）。差分 × `config.perception.gainScale`（全体の倍率。関係が深まるペースを決める）× `perceptionGainScale`（キャラクターごと）× `exp(−p² / (2σ²))` を足し、上限で収める。σ は `profile.perceptionDampingSigma`。
  - 差分が負: `negativeWeight` をかける。今の値が下端より下にあるとき、`q = (下端 − 今の値) / (下端 − 1)` を 0〜1 に収め（下端 ≤ 1 なら q = 1）、差分 × `exp(−q² / (2σ²))` を足す。下端以上なら減衰なし。下限は 1。
- `decayFamiliarity(familiarity: number, elapsedDays: number, config?): number` — `elapsedDays` が `familiarityDecayAfterDays` を超えたぶん × `familiarityDecayPerDay` を引く（下限 1）。

### `sessionAccumulator.ts`

- `addMessageToSession(pending: PendingSession | null, contribution: PerceptionContribution, now: Date): PendingSession` — `pending` が無ければ新しく作る。`peak` は軸ごとに絶対値が大きいほう（同じなら前のまま）、`last` は今回の寄与（書いていない軸は 0 として上書き）、`messageCount` を1増やし、`lastMessageAt` を更新。
- `isSessionEnded(pending: PendingSession, now: Date, config?): boolean` — `now − lastMessageAt` が `sessionGapMinutes` 以上。
- `settleSession(pending: PendingSession): PerceptionContribution` — 軸ごとに `(peak + last) / 2`（ピーク・エンドの法則）。

### `affectProjection.ts`

- `createInitialAffectState(character: CharacterDefinition, profile: AffectProfile, now: Date, config?): CharacterAffectState` — 情動は 0、気分は平常値、欲求は `{ fatigue: fatigueBaseline, loneliness: 0 }`、関係値は `character.initialPerception`。
- `projectAffectState(state, now: Date, ctx: { profile: AffectProfile; lifestyle: Lifestyle; timeZone: string; stages: RelationshipStage[]; stageKey: string }, config?): CharacterAffectState` — 保存してある状態を `now` まで進める。順に: ① 終わったセッションがあれば確定して関係値に反映（`pendingSession` を `null` に）② 情動の減衰 ③ 疲労の計算・孤独感の増加・familiarity の減衰 ④ 気分を（欲求でずらした）平常値へ戻す ⑤ `perceptionStageBase` を今の段階に合わせ、`affectUpdatedAt` を `now` にする。`now` が `affectUpdatedAt` より前なら経過時間は 0。`stageKey` が `stages` に無ければ先頭の段階。
- **状態レコードに書くのは `emotionUpdater`（とデバッグ用のエンドポイント）だけ。** `dialogueGenerator` は進めた結果を読むだけで保存しない（書き手を1つにして、上書きの衝突を避ける）。

### `affectText.ts`

- `formatAffectForPrompt(state: CharacterAffectState, config?): string` — 気分（8象限の名前 × 強さの3段階）、活動中の情動（名前と強さのラベル）、欲求（疲労・孤独感）を文章にする。世界観・キャラクターに依存する語は使わない。
- `describeReunionBehavior(style: AttachmentStyle): string` — 愛着のスタイルごとの、久しぶりに会ったときのふるまいの説明（定型文）。

## 注意

- `needs.ts` は `absenceSimulator/actionSlots.ts` の `buildActionSlots` を使う（`lib` から機能のフォルダを読む向きになっている。生活様式の枠の展開を二重に持たないため）。
- 設定値はすべて仮のもの。変えるときは `perceptionGrowthSimulation.ts` の試算と AI 応答テストで確かめる。
