# api/test/unit/debugCharacterState

`src/debugCharacterState/` の単体テスト。対象の概要は [`../../../src/debugCharacterState/README.md`](../../../src/debugCharacterState/README.md) を参照。2026-09-19 に、感情・関係値の状態の新しい形（[D-040](../../../../.notes/decision-history.md#d-040)）に合わせて書き直した。

## 対象と方針

`runDebugCharacterState` が公開関数。`../../../src/lib/dynamo.js` の低いレベルの関数（`getStoredAffectState`・`getRelationshipRecord`・`saveCharacterAffectState`）を `vi.mock()` で差し替え、状態を読んで時間を進める処理（`lib/affectStateStore.ts`）は本物を使う。現在時刻はリクエストの `now` で固定する。入力の検証はハンドラーのテスト（[`../handlers/README.md`](../handlers/README.md) の `debugCharacterState.test.ts`）で確かめる。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/debugCharacterState/index.ts` | どの見出しも指定しない → 保存せずに、`now` まで進めた値を返すこと、`emotions`・`mood`・`needs`（`loneliness` だけ）・`perception` のそれぞれの指定でその見出しだけが変わること、複数の見出しの同時指定、`perception` を書き換えると段階の下端（`perceptionStageBase`）が空になること、段階の上限を超える `perception` もそのまま保存されること、レスポンスの `stage`（`key`・`label`・`maxPerception`。無ければ `{}`）と `pendingSession`、状態レコードが無いときに初期状態を土台にすること |
