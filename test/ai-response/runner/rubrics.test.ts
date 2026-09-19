import { describe, it, expect } from "vitest";

import { loadRubric, parseRubric } from "./rubrics.js";
import { TARGET_FUNCTIONS } from "./types.js";

describe("loadRubric", () => {
  for (const fn of TARGET_FUNCTIONS) {
    it(`rubrics/${fn}.md が読める → 3〜6個の観点になり、各観点にid/name/description/anchorsがある`, async () => {
      const criteria = await loadRubric(fn);

      expect(criteria.length).toBeGreaterThanOrEqual(3);
      expect(criteria.length).toBeLessThanOrEqual(6);

      for (const c of criteria) {
        expect(c.id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.description.length).toBeGreaterThan(0);
        expect(c.anchors[5].length).toBeGreaterThan(0);
        expect(c.anchors[3].length).toBeGreaterThan(0);
        expect(c.anchors[1].length).toBeGreaterThan(0);
      }

      // id はファイル内で一意
      const ids = criteria.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("存在しないファイル → 例外", async () => {
    await expect(loadRubric("dialogueGenerator", "/no/such/dir")).rejects.toThrow();
  });
});

describe("parseRubric", () => {
  const VALID = `# 評価基準: dummy

前提の説明。

### fooBar: サンプルの観点

何を見るかの説明。

- 5: 満点の状態
- 3: 中間の状態
- 1: 最低の状態
`;

  it("正常な書式 → 観点が1つ読める", () => {
    const criteria = parseRubric(VALID, "dummy.md");
    expect(criteria).toEqual([
      {
        id: "fooBar",
        name: "サンプルの観点",
        description: "何を見るかの説明。",
        anchors: { 5: "満点の状態", 3: "中間の状態", 1: "最低の状態" },
      },
    ]);
  });

  it("複数観点 → すべて読める", () => {
    const markdown = `${VALID}
### bazQux: 別の観点

別の説明。

- 5: 満点
- 3: 中間
- 1: 最低
`;
    const criteria = parseRubric(markdown, "dummy.md");
    expect(criteria.map((c) => c.id)).toEqual(["fooBar", "bazQux"]);
  });

  it("観点の見出しが1つも無い → 例外（ファイルパスを含む）", () => {
    expect(() => parseRubric("# 評価基準: dummy\n\n本文だけ。\n", "path/to/dummy.md")).toThrow(
      /path\/to\/dummy\.md/
    );
  });

  it("アンカー行（- 1:）が欠けている → 例外", () => {
    const broken = `### fooBar: サンプルの観点

説明。

- 5: 満点の状態
- 3: 中間の状態
`;
    expect(() => parseRubric(broken, "broken.md")).toThrow(/fooBar/);
  });

  it("アンカー行（- 3:）が欠けている → 例外", () => {
    const broken = `### fooBar: サンプルの観点

説明。

- 5: 満点の状態
- 1: 最低の状態
`;
    expect(() => parseRubric(broken, "broken.md")).toThrow(/fooBar/);
  });

  it("説明が無い（アンカーだけ） → 例外", () => {
    const broken = `### fooBar: サンプルの観点

- 5: 満点の状態
- 3: 中間の状態
- 1: 最低の状態
`;
    expect(() => parseRubric(broken, "broken.md")).toThrow(/説明/);
  });

  it("アンカーが重複している → 例外", () => {
    const broken = `### fooBar: サンプルの観点

説明。

- 5: 満点の状態
- 5: もう一つの満点
- 3: 中間の状態
- 1: 最低の状態
`;
    expect(() => parseRubric(broken, "broken.md")).toThrow(/重複/);
  });
});
