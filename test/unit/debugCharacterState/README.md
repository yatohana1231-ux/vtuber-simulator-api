# api/test/unit/debugCharacterState

`src/debugCharacterState/` の単体テスト。対象の概要は [`../../../src/debugCharacterState/README.md`](../../../src/debugCharacterState/README.md) を参照。

## 対象と方針

`runDebugCharacterState` が公開関数。`../../../src/lib/dynamo.js`（`getCharacterState`・`saveCharacterState`）を `vi.mock()` でモジュールごと差し替えている。入力の検証はハンドラーのテスト（[`../handlers/README.md`](../handlers/README.md) の `debugCharacterState.test.ts`）で確かめる。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/debugCharacterState/index.ts` | 両方省略で保存せずに今の値を返すこと（`getCharacterState` に `character.initialPerception` が渡る）、`mood` だけ・`perception` だけの指定でもう片方は今の値のまま保存すること、両方の指定、状態レコードが無いときに既定値（`initialPerception`）を土台に保存すること |
