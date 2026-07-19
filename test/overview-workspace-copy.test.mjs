import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("overview workspace path exposes complete hover text and a working copy action", () => {
  const overview = read("core/app/src/components/desktop-v627/overview-page.tsx");
  const copyableValue = read("core/app/src/components/desktop-v627/copyable-status-value.tsx");
  const styles = read("core/app/src/app/desktop-v72.css");

  assert.match(overview, /label="当前工作区"[^>]+copyable=\{Boolean\(value\?\.machine\.workspaceRoot\)\}/);
  assert.match(copyableValue, /title=\{value\}/);
  assert.match(copyableValue, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(copyableValue, /aria-label=\{copied \? `已复制\$\{label\}/);
  assert.match(copyableValue, /<Copy aria-hidden="true" \/>/);
  assert.match(styles, /\.v72-copy-status-value:focus-visible/);
});
