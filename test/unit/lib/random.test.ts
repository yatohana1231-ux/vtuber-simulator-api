import { describe, it, expect, vi } from "vitest";
import { weightedPick } from "../../../src/lib/random.js";

describe("weightedPick", () => {
  it("Math.randomが0を返す → 重みが正の先頭の要素が選ばれる", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const items = ["a", "b", "c"];
    expect(weightedPick(items, () => 1)).toBe("a");
  });

  it("Math.randomが1に限りなく近い値を返す → 重みが正の末尾の要素が選ばれる", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999999);
    const items = ["a", "b", "c"];
    expect(weightedPick(items, () => 1)).toBe("c");
  });

  it("重み4,2,2,1でMath.randomが0.5を返す → 重みの比に応じた区間（2番目）の要素が選ばれる", () => {
    // 合計9、0.5*9=4.5。累積和は 4, 6, 8, 9。4.5は2番目の区間（4〜6）に入る。
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const items = [
      { key: "a", weight: 4 },
      { key: "b", weight: 2 },
      { key: "c", weight: 2 },
      { key: "d", weight: 1 },
    ];
    expect(weightedPick(items, (item) => item.weight).key).toBe("b");
  });

  it("重みが0以下の要素がある → その要素は選ばれない", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const items = [
      { key: "zero", weight: 0 },
      { key: "positive", weight: 5 },
    ];
    // 重み0の要素はスキップされ、乱数の値にかかわらず唯一の正の重みの要素が選ばれる
    expect(weightedPick(items, (item) => item.weight).key).toBe("positive");
  });

  it("負の重みの要素がある → その要素は選ばれない", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999999);
    const items = [
      { key: "positive", weight: 3 },
      { key: "negative", weight: -1 },
    ];
    expect(weightedPick(items, (item) => item.weight).key).toBe("positive");
  });

  it("Math.randomが1を返し累積和が乱数値を超えないまま末尾まで進む → 重みが正の最後の要素を返す", () => {
    // 実際の Math.random() は [0, 1) しか返さないが、境界の丸め誤差を想定したフォールバックを
    // 確認するため、モックで1（閾値 = 重みの合計と一致し、どの累積和も閾値を「超えない」）を返す。
    vi.spyOn(Math, "random").mockReturnValue(1);
    const items = [
      { key: "a", weight: 0.1 },
      { key: "b", weight: 0.2 },
    ];
    expect(weightedPick(items, (item) => item.weight).key).toBe("b");
  });

  it("空配列を渡す → 例外を投げる", () => {
    expect(() => weightedPick([], () => 1)).toThrow();
  });

  it("重みの合計が0の配列を渡す → 例外を投げる", () => {
    const items = [
      { key: "a", weight: 0 },
      { key: "b", weight: 0 },
    ];
    expect(() => weightedPick(items, (item) => item.weight)).toThrow();
  });

  it("重みの合計が負の配列を渡す → 例外を投げる", () => {
    const items = [{ key: "a", weight: -1 }];
    expect(() => weightedPick(items, (item) => item.weight)).toThrow();
  });
});
