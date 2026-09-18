# api/test

`api/` リポジトリ内のテスト資材を置くフォルダ。テストの考え方・仕様書はこのリポジトリの外、ルートの [`test/README.md`](../../test/README.md)・[`test/test_unit/README.md`](../../test/test_unit/README.md) にある。テストを実施・実装する前に必ずそちらを読むこと。

## 構成

| フォルダ | 内容 |
|---|---|
| [`events/`](events/README.md) | Lambda コンソールのテストイベントに貼り付ける JSON。廃止済みの `/chat` 前提のまま古くなっている（`.notes/_followup.md` の F-011 参照） |
| [`unit/`](unit/README.md) | Vitest で実行する単体テストコード。`src/` と同じフォルダ構成 |

## 実行

```bash
npm test         # vitest run（1回実行。CI もこれを実行する）
npm run test:watch  # vitest（ウォッチモード）
```

設定は [`../vitest.config.ts`](../vitest.config.ts) を参照。

CI（[`../.github/workflows/deploy-stg.yml`](../.github/workflows/deploy-stg.yml)）は `develop` ブランチへの push 時、型チェック（`tsc --noEmit`）の直後・ビルド（`npm run build`）の前に `npm test` を実行する。失敗すると、以降のビルドと stg への `cdk deploy` は行われない。
