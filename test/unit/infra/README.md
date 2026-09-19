# api/test/unit/infra

`infra/functions/`（CDK が組み込む CloudFront Functions のコード）の単体テスト。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `apiAuthFunction.test.ts` | `infra/functions/api-auth.js` | `handler`: `OPTIONS` を資格情報なしで通すこと、正しい資格情報（コロンを含むパスワード・日本語の ID/パスワードを含む）で `authorization` ヘッダーを削除して通すこと、誤ったパスワード・未登録の ID・`Authorization` なし・`Basic` 以外の形式・壊れた base64・空の ID/パスワード・KVS の値の形式不正で 401 になること、401 応答の CORS ヘッダー（許可したオリジンのときだけ `access-control-allow-origin`/`vary: origin` が付き、`www-authenticate` は付かないこと）、`statusDescription`/`body` の形。ファイルサイズが CloudFront Functions の上限（10 KB）未満であること |

## CloudFront Functions のコードの読み込み方

CloudFront Functions の実行環境は無いため、共通ヘルパー [`loadApiAuthHandler.ts`](loadApiAuthHandler.ts) の `loadHandler` が、`infra/functions/api-auth.js` をファイルとして読み、`import` の2行を取り除き、`__ALLOWED_ORIGINS__` プレースホルダーをテスト用のオリジン一覧の JSON に置き換えたうえで、`new Function("cf", "crypto", "Buffer", ...)` で評価して `handler` を取り出す。`cf` は `kvs().get(key)` だけを持つ偽物（未登録キーは例外を投げる）、`crypto`/`Buffer` は Node のものをそのまま渡す。あわせて `is401` と、イベント・応答の型（`CfEvent`/`CfHeaders`/`Cf401Response` 等）もここで export している。

このヘルパーは `apiAuthFunction.test.ts` だけでなく、[`../scripts/manageTesters.test.ts`](../scripts/README.md)（テスター登録スクリプトが作る値が `handler` で実際に通ることの確認）からも使う。
