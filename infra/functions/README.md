# api/infra/functions

API 専用 CloudFront（`infra/lib/api-entrance.ts`。`.notes/done/api-access-control-roadmap.md`、2026-09-19 に stg にデプロイ済み）に組み込む CloudFront Function のコードを置くフォルダ。単体テストは [`../../test/unit/infra/README.md`](../../test/unit/infra/README.md) を参照。

## `api-auth.js`

viewer request イベントに紐付ける CloudFront Function（ランタイム: cloudfront-js-2.0）。API 専用 CloudFront の唯一の入口で Basic 認証の資格情報を検証し、通らなければその場で 401 を返す。通ったリクエストは `Authorization` ヘッダーを削除し、照合したテスターの ID を `x-tester-id` ヘッダーに入れてからオリジン（API Gateway）に転送する（API Gateway 側には元の `Authorization` は送らない）。

### 振る舞い

1. 判定より前に、リクエストに含まれる `x-tester-id` ヘッダーを必ず削除する（クライアントが偽の値を送ってきても、この時点で消える。後述のとおり照合成功時にだけ確かめた ID の値で入れ直す）。
2. `OPTIONS`（CORS のプリフライト）は資格情報なしでそのまま通す（`x-tester-id` は 1. で消えたまま付かない）。
3. `authorization` ヘッダーが `Basic <base64(id:password)>` の形でなければ 401。base64 をデコードし、最初の `:` で ID とパスワードに分ける（パスワードに `:` が含まれていてもよい）。ID・パスワードのどちらかが空でも 401。
4. KeyValueStore（`cf.kvs()`、1関数に1つ）から ID をキーに値を読む。キーが無い（未登録の ID）と例外になるため捕まえて 401 にする。値の形式が不正（`salt:hash` の形でない、どちらかが空）でも 401。
5. `sha256(salt + ":" + password)` を計算し、KVS の `hash` と**全長比較の定数時間比較**（長さが違えば即 false、同じなら全文字の XOR を OR で集めて 0 かどうか）で照合する。`crypto.timingSafeEqual` は cloudfront-js-2.0 に無いための自前実装（[`api-access-control-roadmap.md`](../../../.notes/done/api-access-control-roadmap.md) の「フェーズ1の確認結果」参照）。一致しなければ 401（`x-tester-id` は付かないまま）。
6. 通れば `delete request.headers.authorization` し、照合した ID を `x-tester-id` ヘッダー（値は UTF-8 の base64url、パディングなし）に入れてから `request` を返す。

### `x-tester-id` ヘッダー（テスターの ID の受け渡し）

`.notes/done/tester-character-ownership-roadmap.md` の「API の契約」に基づく。API 専用 CloudFront は API キー（CloudFront しか持たない）を付けて API Gateway を呼ぶため、`x-tester-id` はこの関数が付けたものしか API Gateway には届かない。

- **付けるタイミング:** Basic 認証の資格情報の照合に成功したリクエストにのみ、`Authorization` を削除するのと同時に付ける。`OPTIONS`・401 応答には付かない。
- **符号化:** 照合した ID（UTF-8 文字列）を base64url（パディングなし。`+` → `-`、`/` → `_`、末尾の `=` を除く）にした文字列を値にする。標準の `Buffer.from(str, "utf8").toString("base64")` を作ったうえで、上記の置き換え・除去を自前のループで行っている（正規表現・`Buffer` の `"base64url"` エンコーディングは使わない）。理由: cloudfront-js-2.0 で `Buffer.from(str, "base64url")`/`toString("base64url")` が使えるかはフェーズ1で確認できておらず（確認できたのは `"base64"` のみ。[`api-access-control-roadmap.md`](../../../.notes/done/api-access-control-roadmap.md) の「フェーズ1の確認結果」参照）、不安があるため自前実装にした。
- **偽物の除去:** クライアントが送ってきた `x-tester-id` ヘッダーは、`OPTIONS` かどうかの判定より前（関数の冒頭）で必ず削除する。したがって、照合に成功したときは確かめた ID の値で必ず上書きされ、それ以外（401・`OPTIONS`）では付かない。
- Lambda 側（`x-tester-id` のデコードと、テスターとキャラクターの持ち主の確認）は別フェーズ（フェーズ3）で実装する。このフェーズではヘッダーを付けるところまで。

### KeyValueStore の値の形式

キーはテスターの ID、値は文字列 `"<salt>:<hash>"`。

- `salt`: 任意の文字列（テスター登録スクリプト側〔フェーズ4で実装予定〕が生成する）
- `hash`: `sha256(salt + ":" + password)` の16進数文字列（`crypto.createHash("sha256").update(...).digest("hex")`）

パスワードそのものは KVS にもコードにも置かない。

### 401 応答の仕様

- `statusCode: 401`、`statusDescription: "Unauthorized"`
- 本文: JSON `{"error":"unauthorized"}`（`content-type: application/json`）
- `WWW-Authenticate` は付けない（ブラウザ標準の Basic 認証ダイアログを出さないため）
- リクエストの `origin` ヘッダーが許可オリジン一覧に含まれるときだけ、`access-control-allow-origin`（そのオリジンの値）と `vary: origin` を付ける。含まれない・`origin` ヘッダーが無いときは CORS 関連のヘッダーを一切付けない。
- CloudFront のレスポンスヘッダーポリシーは関数が返した応答には効かない前提で実装している（CORS ヘッダーは関数内で組み立てる）ため、フェーズ6（デプロイと確認）で実際に付与されるかを確認すること。

### プレースホルダー `__ALLOWED_ORIGINS__`

ファイル中の `const ALLOWED_ORIGINS = __ALLOWED_ORIGINS__;` は、CDK が関数を組み込む際（フェーズ3）に許可するオリジンの一覧を表す JSON 配列の文字列（例: `["https://d35a8wyhb727oo.cloudfront.net","http://localhost:5173"]`）に置換する。置換前のこのファイル単体は有効な JavaScript ではない。単体テストでは、プレースホルダーをテスト用のオリジン一覧の JSON に置き換えてから評価する（詳細は [`../../test/unit/infra/README.md`](../../test/unit/infra/README.md)）。

### 制約・注意事項

- cloudfront-js-2.0 で使えない Node 固有の API（`require`、`process` など）は使わない。コードは CloudFront Functions の上限である 10 KB 未満に収める（オリジンの一覧が増えるとプレースホルダー置換後のサイズも増える点に注意）。
- パスワード・ハッシュ・`Authorization` ヘッダーの値はログに出さない（`console.log` は使っていない）。
- このフォルダには関数のコードのみを置く。CDK への組み込みは `../lib/api-entrance.ts`（`ApiEntrance` Construct）で行う。

### CDK への組み込み（`../lib/api-entrance.ts`）

`.notes/done/api-access-control-roadmap.md` のフェーズ3で実装。`ApiEntrance` Construct が、このファイルをテキストとして読み込み（`fs.readFileSync`）、`__ALLOWED_ORIGINS__`（先頭コメント内の記述も含めすべて）を `props.allowedOrigins` の JSON 配列文字列に置換したうえで `cloudfront.FunctionCode.fromInline` に渡す。置換後のコードを `cloudfront.Function`（`runtime: FunctionRuntime.JS_2_0`）として作成し、`keyValueStore` に `cloudfront.KeyValueStore`（名前 `vtuber-simu-testers-${stageName}`。テスター登録スクリプトは次のフェーズ4で実装）を関連付ける。関数は API 専用 `cloudfront.Distribution` の `defaultBehavior.functionAssociations`（`eventType: FunctionEventType.VIEWER_REQUEST`）に紐付け、レスポンスヘッダーポリシー（CORS、`originOverride: true`）と併用する。

`ApiEntrance` はほかに、API キーの値を保持する Secrets Manager のシークレット（`generateSecretString`、英数字32文字）、API Gateway の使用量プラン（スロットル・日次クォータ）と API キー、CloudFront のオリジンへのカスタムヘッダー `x-api-key`（シークレットの動的参照）も持つ。`../lib/vtuber-simulator-stack.ts` 側は、4つの POST に `apiKeyRequired: true` を付け、`defaultCorsPreflightOptions.allowOrigins` を `cdk.json` の `context.corsAllowedOrigins[stageName]` に絞ったうえで `ApiEntrance` を組み込む。CDK のアサーションテストは `../test/api-entrance.test.ts`（`npm test`。事前に `api/` で `npm run build` して `api/dist/` を作っておく必要がある。Lambda のコードアセットが無いと synth できないため）。
