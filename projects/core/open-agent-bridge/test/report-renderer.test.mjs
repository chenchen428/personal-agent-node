import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

test("mobile report renderer creates a self-contained accessible chart page", () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oab-report-")), "report.html");
  execFileSync(process.execPath, [
    path.join(workspaceRoot, "skills", "open-agent-bridge", "scripts", "render-report.mjs"),
    "--input", path.join(workspaceRoot, "test", "fixtures", "skill-cases", "open-agent-bridge", "report-input.json"),
    "--out", output,
  ]);
  const html = fs.readFileSync(output, "utf8");
  assert.match(html, /viewBox="0 0 720 320"/);
  assert.match(html, /class="chart-point" tabindex="0"/);
  assert.match(html, /<details class="chart-data">/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /\.chart-scroll\{max-width:100%;overflow-x:auto/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
});
