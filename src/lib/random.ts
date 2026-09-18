// -------------------------------------------------------
// 汎用の重み付き抽選
// -------------------------------------------------------

/**
 * items から weightOf で決まる重みに応じて1つを選ぶ。
 *
 * - items が空、または重みの合計が0以下の場合は例外を投げる。
 * - 重みが0以下の要素は選ばれない。
 * - 乱数は Math.random() を使い、[0, 1) の値を重みの累積和にマッピングする
 *   （0 なら重みが正の最初の要素、1に限りなく近い値なら重みが正の最後の要素が選ばれる）。
 * - 浮動小数の誤差で累積和が乱数値を超えないまま末尾まで進んだ場合は、
 *   重みが正の最後の要素を返す。
 */
export function weightedPick<T>(
  items: readonly T[],
  weightOf: (item: T) => number
): T {
  if (items.length === 0) {
    throw new Error("weightedPick: items が空です");
  }

  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (totalWeight <= 0) {
    throw new Error("weightedPick: 重みの合計が0以下です");
  }

  const threshold = Math.random() * totalWeight;

  let cumulative = 0;
  let lastPositiveWeightItem: T | undefined;
  for (const item of items) {
    const weight = weightOf(item);
    if (weight <= 0) continue;
    lastPositiveWeightItem = item;
    cumulative += weight;
    if (threshold < cumulative) {
      return item;
    }
  }

  // 浮動小数の誤差で threshold が cumulative を超えたまま末尾まで進んだ場合のフォールバック。
  return lastPositiveWeightItem as T;
}
