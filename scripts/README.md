# scripts

開発・運用用のスクリプト（`api/` 配下で実行）。

| ファイル | 内容 |
|---|---|
| `copy-content.mjs` | `content/` を `dist/content/` にコピーする（README は除く）。`npm run build`（`build:content`）から実行される |
| `test-runner.ts` | 各機能の `run*` を実際の AWS（Bedrock＋stg の DynamoDB）に対して直接呼ぶ CLI。`--package <id>` でパッケージを指定する。`npx tsx scripts/test-runner.ts --help` |
| `clear-tables.mjs` | stg の DynamoDB テーブルを全削除する。会話ログも含めて消えるため注意 |
| `manage-testers.ts` | API 専用 CloudFront（`.notes/api-access-control-roadmap.md`）が照合するテスターの資格情報を CloudFront KeyValueStore に登録・削除・一覧する CLI。下の「`manage-testers.ts`」節を参照 |

## 注意

- `test-runner.ts` は `npx tsx` で `.mustache` のインポートに失敗する既知の問題がある（`.notes/_followup.md` の F-006 参照）。
- `test-runner.ts` は `tsconfig.json` の対象外（`include` は `src/**/*` のみ）のため、`npx tsc --noEmit` では型チェックされない。`manage-testers.ts` も同様に `tsconfig.json` の `include` の対象外だが、`test/unit/scripts/manageTesters.test.ts` がこのファイルを import しているため、`test/**/*` 経由で型チェックされる（`npx tsc --noEmit` で確認できる）。

## `manage-testers.ts`

API 専用 CloudFront の viewer request で動く CloudFront Function（`infra/functions/api-auth.js`）が照合する、テスターの ID・パスワードを CloudFront KeyValueStore に登録・削除・一覧するローカル実行用のスクリプト。**このスクリプト自身は AWS への読み取り操作（`describe-key-value-store`/`describe-stacks`/`list-keys`）に加え、`add`/`remove` では変更操作（`put-key`/`delete-key`）を実行する。**KeyValueStore を持つスタック（`ApiEntrance` Construct、`.notes/api-access-control-roadmap.md` フェーズ3）がデプロイ済みであることが前提。

### 使い方

```bash
npx tsx scripts/manage-testers.ts add <id>       # 登録（既存のIDは上書き）。パスワードを対話入力
npx tsx scripts/manage-testers.ts remove <id>    # 削除
npx tsx scripts/manage-testers.ts list           # 登録済みIDの一覧（値は表示しない）
npx tsx scripts/manage-testers.ts --help

# KeyValueStore の ARN を明示する場合（省略時は CloudFormation の出力から自動取得）
npx tsx scripts/manage-testers.ts list --kvs-arn arn:aws:cloudfront::<account>:key-value-store/<id>
```

- `--kvs-arn` を省略すると、`aws cloudformation describe-stacks --stack-name VtuberSimulatorStack` の出力 `TesterKeyValueStoreArn` から取得する（読み取りのみ）。
- `--stage`（既定 `stg`）は現時点では未使用（スタック名が固定のため）。将来ステージごとにスタックを分けたときのための予約。

### 前提

- AWS CLI **v2** がインストールされていること（`cloudfront-keyvaluestore` サブコマンドは v2 のみ）。
- 有効な AWS 資格情報（環境変数 / 名前付きプロファイル）が設定されていること。**一時的な資格情報（STS の一時トークン）を使う場合、リージョンの STS エンドポイントで取得したトークンが必要**（`.notes/api-access-control-roadmap.md` の「フェーズ1の確認結果」参照）。
- KeyValueStore を持つスタックがデプロイ済みであること。

### パスワードの扱い

- コマンドライン引数では受け取らない（シェルの履歴に残るため）。
- 標準入力が TTY のとき: エコーを切って2回入力させ、一致を確認する。
- 標準入力がパイプ（TTY でない）のとき: 1行読み取る（確認なし）。CI や自動化スクリプトからの利用を想定。
- パスワードは8文字以上。ID は空でなく、`:` を含まず、UTF-8 で 512 バイト以下（`:` を含めないのは、Basic 認証が最初の `:` で ID とパスワードを分けるため）。
- 保存する値は `salt:hash`（`salt` は `crypto.randomBytes(16)` の16進数、`hash` は `sha256(salt + ":" + password)` の16進数）。`infra/functions/api-auth.js` の照合ロジックと同じ規則。
- **パスワード・salt・hash・`put-key` のコマンドライン全体は、ログにも画面にも一切出力しない。** AWS CLI がエラーを返した場合も、`put-key`（値をコマンドライン引数に含む）のエラーメッセージは常に定型文のみを表示し、CLI の生のエラー出力（引数を含みうる）はそのまま出さない。

### 反映の遅れ

`add`/`remove` の直後、CloudFront Functions の KeyValueStore への反映まで数秒かかることがある（実行後にその旨を表示する）。登録・削除の直後に API 専用 CloudFront で確認する場合は、少し待ってから試すこと。
