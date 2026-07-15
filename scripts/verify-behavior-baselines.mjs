#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "registry", "behavior-baselines.json");
const replay = process.argv.includes("--run");
const failures = [];
const passed = [];

const registry = readJson(registryPath, "registry/behavior-baselines.json");
if (registry?.schemaVersion !== 1) fail("registry schemaVersion must be 1");
if (registry?.phase !== 0) fail("registry phase must be 0");
requireTrackedFile(registry?.architectureDecision, "accepted architecture decision");
if (!Array.isArray(registry?.workflows) || registry.workflows.length !== 8) fail("registry must contain the eight Phase 0 workflows");

const ids = new Set();
for (const workflow of registry?.workflows || []) {
  const prefix = workflow?.id || "unnamed workflow";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix)) fail(`${prefix}: id must be lower hyphen-case`);
  if (ids.has(prefix)) fail(`${prefix}: duplicate id`);
  ids.add(prefix);
  if (!String(workflow?.label || "").trim()) fail(`${prefix}: label is required`);
  if (!Array.isArray(workflow?.requirements) || workflow.requirements.length < 2 || workflow.requirements.some((item) => !String(item).trim())) fail(`${prefix}: at least two requirements are required`);
  if (!Array.isArray(workflow?.command) || workflow.command.length < 5 || workflow.command.some((item) => typeof item !== "string" || !item)) fail(`${prefix}: deterministic command array is required`);
  if (JSON.stringify(workflow?.command?.slice(0, 4)) !== JSON.stringify(["node", "--import", "tsx", "--test"])) fail(`${prefix}: baseline replay must use the local TypeScript Node test runner`);
  const casePath = requireTrackedFile(workflow?.case, `${prefix}: case`);
  const fixture = casePath ? readJson(casePath, workflow.case) : null;
  if (fixture?.schemaVersion !== 1 || fixture?.id !== prefix) fail(`${prefix}: case identity or schema is invalid`);
  if (fixture?.workflow !== workflow.label) fail(`${prefix}: case workflow label must match registry`);
  if (!Array.isArray(fixture?.acceptance) || fixture.acceptance.length !== workflow.requirements.length) fail(`${prefix}: case acceptance must cover every requirement`);
  if (JSON.stringify(fixture?.acceptance) !== JSON.stringify(workflow.requirements)) fail(`${prefix}: case acceptance differs from registry requirements`);
  if (!fixture?.cloudIndependent) fail(`${prefix}: case must declare whether the current behavior is Cloud-independent`);
  for (const argument of workflow?.command?.slice(4) || []) {
    if (!argument.startsWith("-")) requireTrackedFile(argument, `${prefix}: replay input`);
  }
  if (replay && !failures.some((item) => item.startsWith(`${prefix}:`))) {
    const result = spawnSync(process.execPath, workflow.command.slice(1), { cwd: root, encoding: "utf8", env: { ...process.env, PERSONAL_AGENT_CLOUD_URL: "http://127.0.0.1:1" } });
    if (result.status !== 0) fail(`${prefix}: replay failed\n${String(result.stderr || result.stdout).trim()}`);
    else passed.push(`${prefix}: replay passed`);
  } else {
    passed.push(`${prefix}: definition passed`);
  }
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`[FAIL] ${message}\n`);
  process.exit(1);
}
for (const message of passed) process.stdout.write(`[OK] ${message}\n`);
process.stdout.write(`Phase 0 behavior baselines ${replay ? "replayed" : "verified"}: ${ids.size}/8\n`);

function requireTrackedFile(relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    fail(`${label}: safe repository-relative path is required`);
    return null;
  }
  const target = path.join(root, relative);
  if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label}: file does not exist: ${relative}`);
    return null;
  }
  return target;
}

function readJson(target, label) {
  try { return JSON.parse(fs.readFileSync(target, "utf8")); }
  catch (error) { fail(`${label}: invalid JSON: ${error.message}`); return null; }
}

function fail(message) { failures.push(message); }
