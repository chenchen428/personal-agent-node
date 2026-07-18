import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("data without a workspace uses the shared illustrated empty state", () => {
  const page = read("core/app/src/components/desktop-v627/data-page.tsx");
  const table = read("core/app/src/components/desktop-v627/data-table.tsx");
  const empty = read("core/app/src/components/desktop-v627/data-empty-state.tsx");

  assert.match(page, /title: "暂无数据"/);
  assert.match(page, /actionLabel: "去对话"/);
  assert.match(page, /illustrated: true/);
  assert.match(page, /\/app\/conversations\?draft=/);
  assert.match(page, /hideTable: true/);
  assert.match(page, /disabled=\{!hasDataSource\}/);
  assert.match(page, /objects\.length \? <footer/);
  assert.match(table, /emptyState\.hideTable/);
  assert.doesNotMatch(table, /IllustratedEmptyState/);
  assert.match(table, /illustrated=\{emptyState\.illustrated\}/);
  assert.match(empty, /IllustratedEmptyState/);
  assert.match(empty, /next\/link/);
  assert.match(empty, /data-empty-action/);
});
