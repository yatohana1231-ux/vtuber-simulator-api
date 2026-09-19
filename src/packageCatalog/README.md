# packageCatalog

パッケージ（キャラクター×世界観）の一覧（`GET /packages`）。`.notes/package-selection-roadmap.md` のフェーズ1b。

| パス | 内容 |
|---|---|
| `index.ts` | `runListPackages` |

## `index.ts`

- `runListPackages()` — `lib/packages.ts` の `listPackageIds()` で並び順（既定のパッケージ `DEFAULT_PACKAGE_ID` が先頭、残りは `packageId` の昇順）を得たあと、順に `loadPackage(packageId)` を呼び、表示用の項目（`PackageSummary` = `{ packageId, displayName, characterName, worldName, description, fixedGreeting, isDefault }`）に詰め替えて返す。`characterName` は `character.name`、`worldName` は `world.name`、`isDefault` は `packageId === DEFAULT_PACKAGE_ID`。
- 1つのパッケージの読み込みが例外になった、または `loadPackage` が `null` を返した（存在しない `packageId`）場合は、そのパッケージを一覧から外して `console.error`（どの `packageId` かが分かるメッセージ）に出し、残りを返す（1つの設定ミスでデモ全体を止めないため）。全部失敗すれば空配列。`listPackageIds()` 自体の例外はそのまま呼び出し元に伝播する。

## 呼び出し元

`src/handlers/packageCatalog.ts`（詳細は [`../handlers/README.md`](../handlers/README.md) の「`packageCatalog.ts`（`/packages`）」節）。
