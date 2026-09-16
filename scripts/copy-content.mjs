// api/content/ を dist/content/ にコピーする（Lambda アセットに同梱するため）。
// Windows と Linux の両方で動くよう、cp コマンドではなく Node の fs を使う。

import { cpSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(apiRoot, "content");
const dest = path.join(apiRoot, "dist", "content");

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.endsWith("README.md"),
});

console.log(`[copy-content] ${src} -> ${dest}`);
