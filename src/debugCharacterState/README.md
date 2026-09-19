# debugCharacterState

デバッグ専用のエンドポイント `POST /debug-character-state` の処理。状態レコード（キャラクター記憶テーブルの `index = "state"`）の `mood`・`perception` を読み取り・書き換える。ブラウザのデモ（`front-web`）のデバッグパネルの「状態」タブから、特定の感情・関係値でのセリフや関係の段階の動きを確かめるために使う（[`.notes/debug-character-state-roadmap.md`](../../../.notes/debug-character-state-roadmap.md)、[D-038](../../../.notes/decision-history.md#d-038)）。

- `index.ts` — `runDebugCharacterState({ characterId, character, mood?, perception? })`。`getCharacterState(characterId, character.initialPerception)` で今の値を読み、`mood`・`perception` のどちらかが指定されていれば置き換えて `saveCharacterState` で保存し、保存後の値を返す。どちらも無ければ保存せずに今の値を返す（読み取り）。
- Bedrock は呼ばない。入力の検証はハンドラー（[`../handlers/debugCharacterState.ts`](../handlers/debugCharacterState.ts)）が行う。
- Lambda と API のリソースは、`infra/cdk.json` の `context.enableDebugEndpoints.<stage>` が `true` のステージ（stg）にだけ作る（`infra/lib/vtuber-simulator-stack.ts`）。
- 関係の段階・会話ログ・重要記憶には触らない。`perception` を上げると、次の `/dialogue-generator` で関係の段階が上がることがある（D-033）。

契約は [`../../README.md`](../../README.md) の「API 仕様」を参照。
