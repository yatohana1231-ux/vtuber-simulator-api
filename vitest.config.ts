import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * .mustache を文字列の default export に変換する。
 * esbuild の `--loader:.mustache=text`（src/mustache.d.ts のアンビエント宣言）と同じ扱いにする。
 */
function mustachePlugin(): Plugin {
  return {
    name: "mustache-as-text",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".mustache")) return null;
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [mustachePlugin()],
  test: {
    globals: false,
    include: ["test/unit/**/*.test.ts", "test/ai-response/**/*.test.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    env: {
      // packages.ts が content/ を読み込む際の探索先（フェーズ3以降、本物の JSON を読むテストで使用）
      CONTENT_DIR: fileURLToPath(new URL("./content", import.meta.url)),
    },
  },
});
