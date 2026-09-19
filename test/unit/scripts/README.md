# api/test/unit/scripts

`scripts/manage-testers.ts`（API 専用 CloudFront が照合するテスターの資格情報を CloudFront KeyValueStore に登録・削除・一覧するローカル用スクリプト。`.notes/api-access-control-roadmap.md` フェーズ4）の単体テスト。対象の概要・使い方は [`../../../scripts/README.md`](../../../scripts/README.md) を参照。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `manageTesters.test.ts` | `scripts/manage-testers.ts` | 純粋な関数（AWS CLI を呼ばない部分）の単体テスト：`validateTesterId`（空・`":"` を含む・512バイト超・日本語の ID）、`validatePassword`（8文字未満）、`createStoredValue`（`"32桁hex:64桁hex"` の形式・同じ salt/password なら決定的）、`parseArgs`（コマンド・ID・`--stage`/`--kvs-arn`・`--help`・不正な入力での例外）。加えて、`createStoredValue` で作った値を偽の KeyValueStore に入れ、`../infra/loadApiAuthHandler.ts` で読み込んだ `infra/functions/api-auth.js` の `handler` に正しい資格情報を渡すと通り、誤ったパスワードでは 401 になることを確かめる（登録スクリプトが作る値と照合ロジックの整合性の確認） |

## 方針

- `child_process.execFile` を呼ぶ部分（AWS CLI の呼び出し・パスワードの対話入力）はテストしない。スクリプトのロジックはテストできるよう、`validateTesterId` / `validatePassword` / `createStoredValue` / `generateSalt` / `parseArgs` を純粋な関数として export している。
- `scripts/manage-testers.ts` は `import.meta` を使って、直接実行されたとき（`npx tsx scripts/manage-testers.ts ...`）だけ `main()` を動かす。このテストファイルから import しても AWS CLI は呼ばれない。
- `scripts/` は `api/tsconfig.json` の `include`（`src/**/*` / `test/**/*` / `vitest.config.ts`）の対象外だが、`test/unit/scripts/manageTesters.test.ts` がこのファイルを import しているため、`test/**/*` 経由で型チェックの対象に入る（`npx tsc --noEmit` で確認できる）。
