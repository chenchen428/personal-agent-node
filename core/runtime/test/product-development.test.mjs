import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureProductDevelopment, productDevelopmentStatus } from "../src/product-development.ts";

const contract = {
  schemaVersion: 1,
  mode: "autonomous",
  repository: "chenchen428/personal-agent",
  url: "https://github.com/chenchen428/personal-agent.git",
  visibility: "private",
  requiredPermission: "WRITE",
  checkout: { relativePath: "projects/personal-agent", recurseSubmodules: true },
  confirmationPolicy: "never",
  cloneFailurePolicy: "stop",
  immutableRuntimePath: "core/current",
};

test("product development clones the registered private root below agent-workspace without touching current", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-product-development-"));
  const config = testConfig(root);
  const calls = [];
  const run = fakeRunner({ calls, permission: "WRITE" });
  try {
    const initial = productDevelopmentStatus({ config, contract, run });
    assert.equal(initial.ready, false);
    assert.equal(initial.canEnsure, true);
    const result = ensureProductDevelopment({ config, contract, run, now: () => new Date("2026-07-19T12:00:00.000Z") });
    assert.equal(result.ready, true);
    assert.equal(result.reused, false);
    assert.equal(result.confirmationPolicy, "never");
    assert.equal(result.checkoutPath, path.join(config.agentWorkspaceRoot, "projects", "personal-agent"));
    assert.ok(result.checkoutPath.startsWith(`${config.agentWorkspaceRoot}${path.sep}`));
    assert.doesNotMatch(result.checkoutPath.replaceAll("\\", "/"), /core\/current/);
    assert.ok(fs.existsSync(path.join(result.checkoutPath, "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(result.checkoutPath, ".codex", "skills")));
    assert.ok(calls.some((entry) => entry.command === "gh" && entry.args.slice(0, 3).join(" ") === "repo clone chenchen428/personal-agent"));
    assert.equal(fs.readdirSync(path.join(config.agentWorkspaceRoot, "projects")).some((name) => name.startsWith(".personal-agent-clone-")), false);
    const state = JSON.parse(fs.readFileSync(path.join(config.dataRoot, "runtime", "product-development.json"), "utf8"));
    assert.equal(state.repository, "chenchen428/personal-agent");
    assert.equal(state.ready, true);

    const reused = ensureProductDevelopment({ config, contract, run });
    assert.equal(reused.reused, true);
    assert.equal(reused.canEnsure, true);
    assert.ok(calls.some((entry) => entry.command === "git" && entry.args.includes("submodule")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("product development fails closed on insufficient private repository permission", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-product-permission-"));
  const config = testConfig(root);
  try {
    const status = productDevelopmentStatus({ config, contract, run: fakeRunner({ permission: "READ" }) });
    assert.equal(status.ready, false);
    assert.equal(status.blocker, "GITHUB_PERMISSION_REQUIRED");
    assert.throws(
      () => ensureProductDevelopment({ config, contract, run: fakeRunner({ permission: "READ" }) }),
      (error) => error.code === "GITHUB_PERMISSION_REQUIRED" && error.exitCode === 5,
    );
    assert.equal(fs.existsSync(path.join(config.agentWorkspaceRoot, "projects", "personal-agent")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("product development removes only its temporary checkout when cloning fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-product-clone-failure-"));
  const config = testConfig(root);
  const projects = path.join(config.agentWorkspaceRoot, "projects");
  try {
    assert.throws(
      () => ensureProductDevelopment({ config, contract, run: fakeRunner({ permission: "ADMIN", cloneFails: true }) }),
      (error) => error.code === "CLONE_FAILED",
    );
    assert.equal(fs.existsSync(path.join(projects, "personal-agent")), false);
    assert.deepEqual(fs.existsSync(projects) ? fs.readdirSync(projects) : [], []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function testConfig(root) {
  const dataRoot = path.join(root, "space");
  const agentWorkspaceRoot = path.join(dataRoot, "agent-workspace");
  fs.mkdirSync(agentWorkspaceRoot, { recursive: true });
  return { dataRoot, agentWorkspaceRoot };
}

function fakeRunner({ calls = [], permission = "WRITE", cloneFails = false } = {}) {
  return (command, args) => {
    calls.push({ command, args: [...args] });
    if (args.includes("--version")) return result(0, `${command} version`);
    if (command === "gh" && args[0] === "auth") return result(0, "authenticated");
    if (command === "gh" && args[0] === "repo" && args[1] === "view") {
      return result(0, JSON.stringify({
        nameWithOwner: "chenchen428/personal-agent",
        visibility: "PRIVATE",
        viewerPermission: permission,
        url: "https://github.com/chenchen428/personal-agent",
        defaultBranchRef: { name: "main" },
      }));
    }
    if (command === "gh" && args[0] === "repo" && args[1] === "clone") {
      const target = args[3];
      fs.mkdirSync(target, { recursive: true });
      if (cloneFails) return result(1, "", "clone failed");
      seedCheckout(target);
      return result(0, "cloned");
    }
    if (command === "git" && args.includes("rev-parse")) return result(0, "true\n");
    if (command === "git" && args.includes("get-url")) return result(0, "https://github.com/chenchen428/personal-agent.git\n");
    if (command === "git" && args.includes("status")) return result(0, "");
    if (command === "git" && args.includes("submodule")) return result(0, "");
    return result(1, "", "unexpected command");
  };
}

function seedCheckout(target) {
  for (const directory of [".git", "registry", "projects/cloud", "projects/personal-agent-node", "skills"]) {
    fs.mkdirSync(path.join(target, ...directory.split("/")), { recursive: true });
  }
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Personal Agent Workspace\n");
  fs.writeFileSync(path.join(target, "registry", "projects.json"), "{}\n");
}

function result(status, stdout = "", stderr = "") {
  return { status, stdout, stderr };
}
