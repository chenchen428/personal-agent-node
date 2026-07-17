import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveXiaohongshuBrowser, resolveXiaohongshuRuntime } from "../src/supervisor.ts";

test("resolves the Xiaohongshu adapter from the immutable Core release", () => {
  assert.equal(
    resolveXiaohongshuRuntime({ releaseRoot: "C:\\PersonalAgent\\current", platform: "win32" }),
    path.join("C:\\PersonalAgent\\current", "core", "channels", "xiaohongshu", "runtime", "xiaohongshu-mcp.exe"),
  );
});

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

test("uses Microsoft Edge as the Windows browser fallback", () => {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assert.equal(resolveXiaohongshuBrowser(
    { dataRoot: "C:\\PersonalAgent\\workspace", env: {} },
    { platform: "win32", existsSync: (candidate) => candidate === edge },
  ), edge);
});
