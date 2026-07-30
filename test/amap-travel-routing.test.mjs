import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = "skills/amap-travel-routing/scripts/query.mjs";

test("AMap POI dry-run is city scoped and never exposes a key", () => {
  const result = spawnSync(process.execPath, [
    script,
    "poi",
    "--keywords",
    "三坊七巷",
    "--city",
    "福州",
    "--city-limit",
    "true",
    "--key-file",
    "must-not-appear",
    "--dry-run",
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /must-not-appear/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.operation, "poi");
  assert.equal(output.dryRun, true);
  assert.equal(output.request.city, "福州");
  assert.equal(output.request.citylimit, "true");
});

test("AMap POI query rejects an unscoped place name", () => {
  const result = spawnSync(process.execPath, [
    script,
    "poi",
    "--keywords",
    "西湖公园",
    "--dry-run",
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required option --city/);
});

test("AMap route dry-run validates coordinates and preserves travel mode", () => {
  const valid = spawnSync(process.execPath, [
    script,
    "route",
    "--mode",
    "walking",
    "--origin",
    "119.296494,26.078061",
    "--destination",
    "119.294362,26.075787",
    "--dry-run",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).request.mode, "walking");

  const invalid = spawnSync(process.execPath, [
    script,
    "route",
    "--mode",
    "walking",
    "--origin",
    "26.078061, 119.296494",
    "--destination",
    "119.294362,26.075787",
    "--dry-run",
  ], { cwd: root, encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /longitude,latitude/);
});
