# debugCharacterState

デバッグ専用のエンドポイント `POST /debug-character-state` の処理。状態レコード（キャラクター記憶テーブルの `index = "state"`）の感情（情動 `emotions`・気分 `mood`・欲求 `needs`）と関係値（`perception`）を読み取り・書き換える（2026-09-19 に [D-040](../../../.notes/decision-history.md#d-040) の新しい状態の形に作り直した）。ブラウザのデモ（`front-web`）のデバッグパネルの「状態」タブから、特定の感情・関係値でのセリフや関係の段階の動きを確かめるために使う（[`.notes/debug-character-state-roadmap.md`](../../../.notes/done/debug-character-state-roadmap.md)、[D-038](../../../.notes/decision-history.md#d-038)）。

- `index.ts` — `runDebugCharacterState(req)`。[`lib/affectStateStore.ts`](../lib/affectStateStore.ts) の `loadProjectedAffectState` で、状態をリクエストの `now` まで進めて読む。`emotions`・`mood`・`needs`・`perception` のどれも指定が無ければ、**保存せずに**進めた値を返す（読み取り。`front-web` の仮想時刻で、時間による変化を確かめられる）。指定があれば、その見出しだけ置き換えて `saveCharacterAffectState` で保存する。
  - `perception` は関係の段階の上限（`maxPerception`）を無視して書ける（デバッグ用）。書き換えたときは段階の下端（`perceptionStageBase`）を空にし、次に時間を進めるときに作り直させる。
  - `needs` で書き換えられるのは `loneliness` だけ。`fatigue` は生活様式と時刻から毎回計算し直されるので、指定されても無視する。
  - レスポンスには、セッションの途中経過（`pendingSession`。まだ関係値に確定していない寄与）と、今の関係の段階（`key`・`label`・`maxPerception`）も入る。
- Bedrock は呼ばない。入力の検証はハンドラー（[`../handlers/debugCharacterState.ts`](../handlers/debugCharacterState.ts)）が行う。
- Lambda と API のリソースは、`infra/cdk.json` の `context.enableDebugEndpoints.<stage>` が `true` のステージ（stg）にだけ作る（`infra/lib/vtuber-simulator-stack.ts`）。
- 関係の段階・会話ログ・重要記憶には触らない。`perception` を上げると、次の `/dialogue-generator` で関係の段階が上がることがある（D-033）。

契約は [`../../README.md`](../../README.md) の「API 仕様」を参照。
