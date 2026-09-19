# api/test/unit/testerCharacters

`src/testerCharacters/` の単体テスト。対象の概要は [`../../../src/testerCharacters/README.md`](../../../src/testerCharacters/README.md) を参照。

## 対象と方針

`runListTesterCharacters`・`runCreateTesterCharacter` が公開関数。`../../../src/lib/dynamo.js`（`listTesterCharacters`・`createTesterCharacter`）を `vi.mock()` でモジュールごと差し替えている。`packages.js` はスタブにせず（`test/unit/README.md` の方針どおり）`CONTENT_DIR` 経由で本物の `api/content/` を読むため、`packageId` の検証（既定パッケージ・形式不正・存在しない ID）は実物のパッケージで確認している。`crypto` の `randomUUID` は `vi.mock("crypto", ...)` + `vi.hoisted()` で差し替え、発番し直しの1回リトライを戻り値の出し分けで確認する。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/testerCharacters/index.ts` | `runListTesterCharacters`（`testerId` を含まない要約への変換、0件で空配列）。`runCreateTesterCharacter`: `packageId` 省略時の既定パッケージ、`label` 省略・空白のみで「キャラクター{n}」（`n` は既存件数+1）、前後の空白の除去、31文字で `TesterCharacterInputError`（30文字は許容）、文字列でない `label` で `TesterCharacterInputError`、存在しない/形式不正な `packageId` で `TesterCharacterInputError`、`MAX_CHARACTERS_PER_TESTER` 件以上で `TesterCharacterLimitError`（`createTesterCharacter` は呼ばれない）、`characterId` が `randomUUID()` で発番されること、`ConditionalCheckFailedException`（`error.name` で判定）での1回だけの発番し直しと成功、2回とも失敗したときの例外の伝播、条件付き書き込み以外の例外はリトライせずそのまま伝播すること |
