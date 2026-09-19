# scripts

開発・運用用のスクリプト（`api/` 配下で実行）。

| ファイル | 内容 |
|---|---|
| `copy-content.mjs` | `content/` を `dist/content/` にコピーする（README は除く）。`npm run build`（`build:content`）から実行される |
| `test-runner.ts` | 各機能の `run*` を実際の AWS（Bedrock＋stg の DynamoDB）に対して直接呼ぶ CLI。`--package <id>` でパッケージを指定する。`npx tsx scripts/test-runner.ts --help` |
| `clear-tables.mjs` | stg の DynamoDB テーブルを全削除する。会話ログも含めて消えるため注意 |
| `manage-testers.ts` | API 専用 CloudFront（`.notes/done/api-access-control-roadmap.md`）が照合するテスターの資格情報を CloudFront KeyValueStore に登録・削除・一覧する CLI。`npm run testers:add` / `testers:remove` / `testers:list` から呼べる。既存の `characterId` をテスターに割り当てる・一覧する・外す（`testers:assign` / `testers:characters` / `testers:unassign`、`.notes/tester-character-ownership-roadmap.md` 検討事項1）も持つ。下の「`manage-testers.ts`」節を参照 |

## 注意

- `test-runner.ts` は `npx tsx` で `.mustache` のインポートに失敗する既知の問題がある（`.notes/_followup.md` の F-006 参照）。
- `test-runner.ts` は `tsconfig.json` の対象外（`include` は `src/**/*` のみ）のため、`npx tsc --noEmit` では型チェックされない。`manage-testers.ts` も同様に `tsconfig.json` の `include` の対象外だが、`test/unit/scripts/manageTesters.test.ts` がこのファイルを import しているため、`test/**/*` 経由で型チェックされる（`npx tsc --noEmit` で確認できる）。

## `manage-testers.ts`

API 専用 CloudFront の viewer request で動く CloudFront Function（`infra/functions/api-auth.js`）が照合する、テスターの ID・パスワードを CloudFront KeyValueStore に登録・削除・一覧するローカル実行用のスクリプト。あわせて、既存の `characterId`（ブラウザ側で作られたもの）をテスターに割り当てる・一覧する・外すコマンドも持つ（`.notes/tester-character-ownership-roadmap.md` 検討事項1・方針2）。**このスクリプト自身は AWS への読み取り操作（`describe-key-value-store`/`describe-stacks`/`list-keys`/`query`）に加え、`add`/`remove`/`assign`/`unassign` では変更操作（`put-key`/`delete-key`/`put-item`/`delete-item`）を実行する。**KeyValueStore を持つスタック（`ApiEntrance` Construct、`.notes/done/api-access-control-roadmap.md` フェーズ3）、および TesterCharactersTable を持つスタック（`.notes/tester-character-ownership-roadmap.md` フェーズ4）がデプロイ済みであることが前提。

### 使い方（資格情報: add/remove/list）

npm scripts（`tsx` を devDependencies に追加済み）経由で呼ぶ。`--` の後がこのスクリプトへの引数。

```bash
npm run testers:add -- <id>              # 登録（既存のIDは上書き）。パスワードを対話入力
npm run testers:add -- <id> --generate   # 登録。パスワードを自動生成し、成功時に1回だけ表示
npm run testers:remove -- <id>           # 削除
npm run testers:list                     # 登録済みIDの一覧（値は表示しない）
npm run testers:list -- --help           # ヘルプ（他のコマンドでも同様）

# KeyValueStore の ARN を明示する場合（省略時は CloudFormation の出力から自動取得）
npm run testers:list -- --kvs-arn arn:aws:cloudfront::<account>:key-value-store/<id>
```

直接 `tsx` を呼ぶこともできる（挙動は同じ）。

```bash
npx tsx scripts/manage-testers.ts add <id>
npx tsx scripts/manage-testers.ts add <id> --generate
npx tsx scripts/manage-testers.ts remove <id>
npx tsx scripts/manage-testers.ts list
npx tsx scripts/manage-testers.ts --help
```

- `--kvs-arn` を省略すると、`aws cloudformation describe-stacks --stack-name VtuberSimulatorStack` の出力 `TesterKeyValueStoreArn` から取得する（読み取りのみ）。
- `--stage`（既定 `stg`）は現時点では未使用（スタック名が固定のため）。将来ステージごとにスタックを分けたときのための予約。
- `--generate` は `add` でのみ指定できる（`remove`/`list` で指定するとエラーになる）。

### 使い方（キャラクターの割り当て: assign/characters/unassign）

ブラウザ側で既に作られている `characterId`（サーバーが `POST /characters` で発番したもの。`.notes/tester-character-ownership-roadmap.md`）を、テスターの持ち物として DynamoDB の TesterCharactersTable に登録する。テスターの資格情報（`add`）とは別の操作で、キャラクターのデータ（会話ログ・記憶など）自体はこのコマンドでは作らない・消さない。

```bash
npm run testers:assign -- <testerId> <characterId>
  # 割り当てる。--package 省略時は yui-modern-tokyo、--label 省略時は「引き継いだキャラクター」
npm run testers:assign -- <testerId> <characterId> --package <packageId> --label <名前>
  # packageId・label を指定して割り当てる（label は1〜30文字）
npm run testers:characters -- <testerId>
  # そのテスターのキャラクターの一覧（characterId・packageId・label・createdAt）
npm run testers:unassign -- <testerId> <characterId>
  # 割り当てを削除する（DynamoDB 上のキャラクターのデータは削除されない）

# テーブル名を明示する場合（省略時は CloudFormation の出力から自動取得）
npm run testers:characters -- <testerId> --table v-simu-tester-characters-stg
```

- 既に同じ `(testerId, characterId)` が登録済みの状態で `assign` を実行すると、上書きせず「すでに登録されています」と表示して終了する（DynamoDB の条件付き書き込み `attribute_not_exists(character_id)` で判定）。
- `characterId` は UUID の形式（`crypto.randomUUID()` が発番する形）でなければエラーになる。
- `--table` を省略すると、`aws cloudformation describe-stacks --stack-name VtuberSimulatorStack` の出力 `TesterCharactersTableName` から取得する（読み取りのみ）。
- `--package`/`--label` は `assign` でのみ指定できる（`characters`/`unassign` で指定するとエラーになる）。

### 前提

- AWS CLI **v2** がインストールされていること（`cloudfront-keyvaluestore` サブコマンドは v2 のみ）。
- 有効な AWS 資格情報（環境変数 / 名前付きプロファイル）が設定されていること。**一時的な資格情報（STS の一時トークン）を使う場合、リージョンの STS エンドポイントで取得したトークンが必要**（`.notes/done/api-access-control-roadmap.md` の「フェーズ1の確認結果」参照）。
- KeyValueStore を持つスタックがデプロイ済みであること。

### パスワードの扱い

- コマンドライン引数では受け取らない（シェルの履歴に残るため）。
- `--generate` を付けない場合:
  - 標準入力が TTY のとき: エコーを切って2回入力させ、一致を確認する（画面には表示しない）。
  - 標準入力がパイプ（TTY でない）のとき: 1行読み取る（確認なし）。CI や自動化スクリプトからの利用を想定。
- `--generate` を付けた場合（`add` のみ）:
  - `crypto.randomBytes` から作った強いパスワード（base64url で20文字。伝達時に紛らわしい記号 `+`/`/`/`=` を含まない）を自動生成する。
  - **登録に成功したときだけ**、標準出力に**1回だけ**表示する（登録に失敗したときは表示しない）。ファイルやログには一切書かない。
  - 表示されたパスワードは、その場で控えたうえでテスターに安全な方法（対面・別経路のチャット等）で伝えること。チャットの共有ログや Issue・PR などには貼らないこと。
- パスワードは8文字以上（`--generate` の生成値は20文字で常に満たす）。ID は空でなく、`:` を含まず、UTF-8 で 512 バイト以下（`:` を含めないのは、Basic 認証が最初の `:` で ID とパスワードを分けるため）。
- 保存する値は `salt:hash`（`salt` は `crypto.randomBytes(16)` の16進数、`hash` は `sha256(salt + ":" + password)` の16進数）。`infra/functions/api-auth.js` の照合ロジックと同じ規則。
- **パスワード・salt・hash・`put-key` のコマンドライン全体は、ログにも画面にも一切出力しない。** AWS CLI がエラーを返した場合も、`put-key`（値をコマンドライン引数に含む）のエラーメッセージは常に定型文のみを表示し、CLI の生のエラー出力（引数を含みうる）はそのまま出さない。

### 反映の遅れ

`add`/`remove` の直後、CloudFront Functions の KeyValueStore への反映まで1分ほどかかることがある（2026-09-19 の確認では約45秒。反映前は正しい資格情報でも 401 になる）（実行後にその旨を表示する）。登録・削除の直後に API 専用 CloudFront で確認する場合は、少し待ってから試すこと（すぐに `list` を実行しても直後は反映されていないことがある）。
