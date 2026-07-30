#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateGiftAdvisorPage, verifyGiftAdvisorPage } from "./generate-page.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(skillRoot, "..", "..");
const examplePlan = path.join(skillRoot, "examples", "template-plan.json");
const targetRoot = path.join(repositoryRoot, "core", "app", "public", "assets", "templates", "gift-advisor-report-v1");

export function buildGiftAdvisorTemplateExample({ check = false } = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-gift-template-"));
  try {
    const projectDir = path.join(temporaryRoot, "space", "projects", "gift-advisor-template-example");
    const output = path.join(projectDir, "derived", "page");
    fs.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(examplePlan, path.join(projectDir, "gift-plan.json"));
    const generated = generateGiftAdvisorPage({ projectDir, output, template: "gift-advisor-report" });
    const verification = verifyGiftAdvisorPage(output);
    if (check) compareDirectories(output, targetRoot);
    else replaceDirectory(output, targetRoot);
    verifyGiftAdvisorPage(targetRoot);
    return {
      ok: true,
      mode: check ? "check" : "write",
      target: path.relative(repositoryRoot, targetRoot),
      artifactSha256: verification.manifest.files["index.html"].sha256,
      planSha256: verification.manifest.source.planSha256,
      files: generated.files,
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function compareDirectories(actualRoot, expectedRoot) {
  if (!fs.existsSync(expectedRoot)) throw new Error("built-in gift template artifact is missing; run the build command");
  const actualFiles = listFiles(actualRoot);
  const expectedFiles = listFiles(expectedRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`built-in gift template file set drifted: expected ${expectedFiles.join(", ")}, generated ${actualFiles.join(", ")}`);
  }
  for (const name of actualFiles) {
    const actual = fs.readFileSync(path.join(actualRoot, name));
    const expected = fs.readFileSync(path.join(expectedRoot, name));
    if (!actual.equals(expected)) throw new Error(`built-in gift template artifact drifted: ${name}`);
  }
}

function listFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return listFiles(path.join(root, entry.name)).map((name) => path.join(entry.name, name));
    return [entry.name];
  }).sort();
}

function replaceDirectory(source, target) {
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${path.basename(target)}.next-${process.pid}`);
  const previous = path.join(parent, `.${path.basename(target)}.previous-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
  fs.cpSync(source, staging, { recursive: true });
  if (fs.existsSync(target)) fs.renameSync(target, previous);
  try {
    fs.renameSync(staging, target);
    if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  try {
    const result = buildGiftAdvisorTemplateExample({ check: process.argv.includes("--check") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { message: error.message } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
