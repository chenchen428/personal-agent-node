import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");


test("Pages is a result library with no template product entry", () => {
  const pages = read("core/app/src/components/desktop-v627/pages-page.tsx");
  const breadcrumb = read("core/app/src/components/desktop-header-breadcrumb.tsx");
  assert.doesNotMatch(pages, /查看模板|pages-template-action|LayoutTemplate/);
  assert.doesNotMatch(breadcrumb, /pages\/templates|findPageTemplate|模板详情/);
});
