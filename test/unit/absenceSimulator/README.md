# api/test/unit/absenceSimulator

`src/absenceSimulator/` の単体テスト。対象の概要は [`../../../src/absenceSimulator/README.md`](../../../src/absenceSimulator/README.md) を参照。外部サービス（Bedrock・DynamoDB）は使わない純粋な計算のテストで、乱数は `vi.spyOn(Math, "random")` で固定する。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `actionSlots.test.ts` | `src/absenceSimulator/actionSlots.ts` | `buildActionSlots`: 期間が空・逆転のとき空配列、平日だけの期間、平日→休日（金曜夜〜土曜朝）で枠の間が空くこと、休日→平日（日曜夜〜月曜朝）で就寝が月曜の起床に切り詰められること、前日から続く日をまたぐ枠が期間の先頭で切り詰められること、期間の端で15分未満になった枠を捨てること、戻り値が昇順で重ならないこと、本物の `tokyo-highschool-vtuber` で12時間を展開したとき全枠が期間内に収まり重ならないこと |
| `eventKindSelection.test.ts` | `src/absenceSimulator/eventKindSelection.ts` | `countEvents` の境界（0以下、1ミリ秒、3時間、11時間59分、12・24・36・48時間、1週間）、`pickEventKinds` の件数（0・負で空配列）と乱数に応じた種類、本物の `eventKinds` での動作 |
| `skeleton.test.ts` | `src/absenceSimulator/skeleton.ts` | `buildAbsenceSkeleton`: 不在3時間で行動の枠3時間分・出来事1件、不在30時間で行動の枠が直近12時間に収まり出来事は3件、`now` が `lastLoginAt` より前なら行動の枠・出来事とも空、期間の ISO 文字列、乱数に応じた種類 |
