// -------------------------------------------------------
// packageCatalog
// パッケージ（キャラクター×世界観）の一覧（GET /packages が呼ぶ）。
// .notes/package-selection-roadmap.md フェーズ1b。
// -------------------------------------------------------

import { DEFAULT_PACKAGE_ID, listPackageIds, loadPackage } from "../lib/packages.js";

/** レスポンス用の、パッケージ1件分の表示用情報 */
export interface PackageSummary {
  packageId: string;
  displayName: string;
  characterName: string;
  worldName: string;
  description: string;
  fixedGreeting: string;
  isDefault: boolean;
}

export interface ListPackagesResult {
  packages: PackageSummary[];
}

/**
 * content/packages/ にある全パッケージの一覧を返す（GET /packages 用）。
 *
 * 並び順は listPackageIds() のとおり（既定のパッケージ DEFAULT_PACKAGE_ID が先頭、
 * 残りは packageId の昇順）。1つのパッケージの読み込みが例外になった、または
 * loadPackage が null を返した（存在しない packageId）場合は、そのパッケージを
 * 一覧から外して console.error に出し（どの packageId かが分かるメッセージ）、
 * 残りを返す。これは、1つのパッケージの設定ミスでデモ全体を止めないため
 * （ロードマップの契約: 「読み込み・検証に失敗したパッケージは、一覧から外して
 * console.error に出す」）。全部失敗すれば空配列を返す。
 *
 * listPackageIds() 自体が投げる例外（content/packages/ の読み取り失敗など）は
 * ここでは捕まえず、そのまま呼び出し元に伝播させる。
 */
export async function runListPackages(): Promise<ListPackagesResult> {
  const packageIds = await listPackageIds();

  const packages: PackageSummary[] = [];
  for (const packageId of packageIds) {
    let pkg;
    try {
      pkg = await loadPackage(packageId);
    } catch (error) {
      console.error(`[packageCatalog] failed to load package: packageId=${packageId}`, error);
      continue;
    }

    if (!pkg) {
      console.error(`[packageCatalog] package not found: packageId=${packageId}`);
      continue;
    }

    packages.push({
      packageId: pkg.id,
      displayName: pkg.displayName,
      characterName: pkg.character.name,
      worldName: pkg.world.name,
      description: pkg.description,
      fixedGreeting: pkg.fixedGreeting,
      isDefault: pkg.id === DEFAULT_PACKAGE_ID,
    });
  }

  return { packages };
}
