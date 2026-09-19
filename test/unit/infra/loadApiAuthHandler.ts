/**
 * `infra/functions/api-auth.js`（API 専用 CloudFront の CloudFront Function）を
 * Node（Vitest）上で実行できる形にして `handler` 関数を取り出す共通ヘルパー。
 *
 * CloudFront Functions の実行環境は無いため、ファイルの内容を文字列として読み、
 * import 文を取り除き、`__ALLOWED_ORIGINS__` プレースホルダーをテスト用の
 * オリジン一覧に置き換えてから、`new Function` で評価する。
 *
 * `apiAuthFunction.test.ts`（api-auth.js のロジックのテスト）と
 * `manageTesters.test.ts`（テスター登録スクリプトが作る値が handler で
 * 実際に通ることの確認）の両方から使う。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const FUNCTION_PATH = fileURLToPath(
  new URL("../../../infra/functions/api-auth.js", import.meta.url)
);

export type CfHeaderValue = { value: string };
export type CfHeaders = Record<string, CfHeaderValue>;
export type CfRequest = {
  method: string;
  headers: CfHeaders;
};
export type CfEvent = { request: CfRequest };

export type Cf401Response = {
  statusCode: number;
  statusDescription: string;
  headers: CfHeaders;
  body: { encoding: string; data: string };
};

export type HandlerResult = CfRequest | Cf401Response;
export type Handler = (event: CfEvent) => Promise<HandlerResult>;

export function is401(result: HandlerResult): result is Cf401Response {
  return "statusCode" in result;
}

/**
 * `infra/functions/api-auth.js` を読み込み、`handler` 関数を取り出す。
 *
 * @param allowedOrigins `__ALLOWED_ORIGINS__` プレースホルダーに置き換えるオリジン一覧
 * @param kvsStore KeyValueStore の中身を模した `{ [id]: "salt:hash" }`
 */
export function loadHandler(
  allowedOrigins: string[],
  kvsStore: Record<string, string>
): Handler {
  const source = readFileSync(FUNCTION_PATH, "utf8");
  const withoutImports = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n");
  // ファイル先頭のコメントにも __ALLOWED_ORIGINS__ という文字列が出てくるため、
  // 全出現箇所を置換する(コメント内の置換はJSとしての意味に影響しない)。
  const code = withoutImports.split("__ALLOWED_ORIGINS__").join(
    JSON.stringify(allowedOrigins)
  );

  const fakeCf = {
    kvs: () => ({
      get: async (key: string) => {
        if (!Object.prototype.hasOwnProperty.call(kvsStore, key)) {
          throw new Error(`key not found: ${key}`);
        }
        return kvsStore[key];
      },
    }),
  };

  const factory = new Function(
    "cf",
    "crypto",
    "Buffer",
    `${code}\nreturn handler;`
  );
  return factory(fakeCf, crypto, Buffer) as Handler;
}
