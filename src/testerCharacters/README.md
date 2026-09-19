# testerCharacters

テスターごとのキャラクターの一覧・作成（`GET`/`POST /characters`）。`.notes/done/tester-character-ownership-roadmap.md` のフェーズ3b。

| パス | 内容 |
|---|---|
| `index.ts` | `runListTesterCharacters` / `runCreateTesterCharacter` |

## `index.ts`

- `MAX_CHARACTERS_PER_TESTER`（= 5） — 1テスターあたりのキャラクターの上限（ロードマップ検討事項2）。
- `runListTesterCharacters(testerId)` — `lib/dynamo.ts` の `listTesterCharacters` をそのまま呼び、`testerId` を含まない要約（`CharacterSummary` = `{ characterId, packageId, label, createdAt }`）の配列にして返す（`createdAt` の古い順は `dynamo.ts` 側で保証済み）。
- `runCreateTesterCharacter(testerId, { packageId?, label? })`:
  - `packageId` は `lib/packages.ts` の `loadRequestedPackage`（既存の4エンドポイントと同じ検証）で解決する。省略時は既定パッケージ（`yui-modern-tokyo`）、形式不正・存在しないパッケージは `TesterCharacterInputError`。
  - `label` は前後の空白を除いて1〜30文字。省略・null・空文字（前後の空白を除いて空）は「キャラクター{n}」（`n` は作成前の既存件数+1）。文字列でない・30文字を超える場合は `TesterCharacterInputError`。
  - 上限確認は `listTesterCharacters` で既存件数を取得して行う。`MAX_CHARACTERS_PER_TESTER` 件以上あれば `TesterCharacterLimitError`。
  - `characterId` は `crypto.randomUUID()` で発番する。`lib/dynamo.ts` の `createTesterCharacter` は `character_id` に対する条件付き書き込み（`attribute_not_exists`）なので、衝突時（`error.name === "ConditionalCheckFailedException"`。実際にはほぼ起きない）は `characterId` を発番し直して1回だけ再試行する。2回目も失敗した場合や、条件付き書き込み以外の例外はそのまま呼び出し元に伝播する。
- エラーは型で区別できるように、`TesterCharacterInputError`（400 に対応）・`TesterCharacterLimitError`（409、メッセージは `"character limit reached"` 固定）の2つの例外クラスを export している。呼び出し側（`src/handlers/testerCharacters.ts`）がステータスコードに変換する。

## 呼び出し元

`src/handlers/testerCharacters.ts`（詳細は [`../handlers/README.md`](../handlers/README.md) の「`testerCharacters.ts`（`/characters`）」節）。
