import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveXiaohongshuBrowser } from "../src/supervisor.ts";

test("uses an explicitly configured Xiaohongshu browser when it exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-xhs-browser-"));
  const browser = path.join(root, "browser");
  fs.writeFileSync(browser, "browser");
  try {
    assert.equal(resolveXiaohongshuBrowser({ dataRoot: root, env: { PRIVATE_SITE_BROWSER_BIN: browser } }), browser);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not silently fall back when an explicit Xiaohongshu browser is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-xhs-browser-"));
  try {
    assert.equal(resolveXiaohongshuBrowser({ dataRoot: root, env: { PRIVATE_SITE_BROWSER_BIN: path.join(root, "missing") } }), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
