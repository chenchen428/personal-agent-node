import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildProbeInvocation,
  createDoctorReport,
  executableNames,
  resolveChromePilotBinary,
  runFixedProbe,
} from "../skills/chromepilot/scripts/doctor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ChromePilot doctor resolves Windows executable shims without Unix commands", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chromepilot-win-"));
  try {
    const shim = path.join(directory, "chromepilot.cmd");
    fs.writeFileSync(shim, "@echo off\r\nexit /b 0\r\n");
    const resolved = resolveChromePilotBinary({
      platform: "win32",
      env: { Path: directory, PATHEXT: ".EXE;.CMD;.BAT" },
    });
    assert.equal(resolved, shim);
    assert.deepEqual(executableNames("win32", ".EXE;.CMD"), [
      "chromepilot.exe",
      "chromepilot.cmd",
      "chromepilot",
    ]);
    const invocation = buildProbeInvocation(shim, ["help"], "win32");
    assert.equal(invocation.options.shell, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ChromePilot doctor resolves executable POSIX binaries", { skip: process.platform === "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chromepilot-posix-"));
  try {
    const binary = path.join(directory, "chromepilot");
    fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.chmodSync(binary, 0o755);
    assert.equal(resolveChromePilotBinary({ platform: "linux", env: { PATH: directory } }), binary);
    assert.equal(buildProbeInvocation(binary, ["doctor"], "linux").options.shell, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ChromePilot doctor executes a Windows command shim", { skip: process.platform !== "win32" }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chromepilot-win-live-"));
  try {
    const shim = path.join(directory, "chromepilot.cmd");
    fs.writeFileSync(shim, "@echo off\r\nexit /b 0\r\n");
    assert.equal(runFixedProbe(shim, ["help"], { platform: "win32" }).ok, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ChromePilot doctor fails closed when the external dependency is missing", () => {
  const report = createDoctorReport({
    platform: "win32",
    env: {},
    pathValue: "",
    skipLive: true,
  });
  assert.equal(report.supported, true);
  assert.equal(report.cli.found, false);
  assert.equal(report.ready, false);
  assert.match(report.guidance.join(" "), /authorized distribution/i);
  assert.match(report.guidance.join(" "), /does not install/i);
});

test("ChromePilot skill is portable and preserves browser safety boundaries", () => {
  const skill = fs.readFileSync(path.join(root, "skills/chromepilot/SKILL.md"), "utf8");
  const setup = fs.readFileSync(path.join(root, "skills/chromepilot/references/platform-setup.md"), "utf8");
  const combined = `${skill}\n${setup}`;
  assert.doesNotMatch(combined, /@[a-z0-9_-]+\/chromepilot/i);
  assert.doesNotMatch(combined, /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b/i);
  assert.doesNotMatch(combined, /\/(?:Users|home)\//);
  assert.doesNotMatch(combined, /node\s+<skill[_-]dir>\/bin\/[a-z]+/i);
  assert.match(skill, /tab-group list/);
  assert.match(skill, /禁止使用 `--activate`/);
  assert.match(skill, /最终确认/);
  assert.match(setup, /Windows/);
  assert.match(setup, /\.cmd/);
  assert.match(setup, /不自动安装/);
});
