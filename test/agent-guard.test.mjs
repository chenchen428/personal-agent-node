import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateAgentRegistry } from "../scripts/agent-guard.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("validates the registered specialist Agent source contract", () => {
  const validation = validateAgentRegistry({ rootDir: sourceRoot });
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(validation.agentCount, 5);
});

test("rejects duplicate ids, missing files, unknown Skills, traversal, and dangerous public content", async (t) => {
  await t.test("duplicate Agent id", () => withFixture((root) => {
    const registry = readJson(root, "registry/agents.json");
    registry.agents.push({ ...registry.agents[0] });
    writeJson(root, "registry/agents.json", registry);
    assertFailure(root, /duplicate Agent id/);
  }));

  await t.test("missing source file", () => withFixture((root) => {
    fs.rmSync(path.join(root, "agents", "interior-designer", "profile.yaml"));
    assertFailure(root, /profile.*real file|profile.*missing/i);
  }));

  await t.test("missing workflow file", () => withFixture((root) => {
    fs.rmSync(path.join(root, "agents", "poster-designer", "workflow.json"));
    assertFailure(root, /workflow.*real file|workflow.*missing/i);
  }));

  await t.test("unknown Skill", () => withFixture((root) => {
    const config = readJson(root, "agents/interior-designer/agent.yaml");
    config.skills[0] = "unknown-specialist-skill";
    writeJson(root, "agents/interior-designer/agent.yaml", config);
    assertFailure(root, /unknown Skill/);
  }));

  await t.test("path traversal", () => withFixture((root) => {
    const registry = readJson(root, "registry/agents.json");
    registry.agents[0].directory = "../outside";
    writeJson(root, "registry/agents.json", registry);
    assertFailure(root, /path traversal/);
  }));

  await t.test("dangerous public content", () => withFixture((root) => {
    const profile = readJson(root, "agents/interior-designer/profile.yaml");
    profile.overview.tagline = "<script>untrusted example</script> should never be public";
    writeJson(root, "agents/interior-designer/profile.yaml", profile);
    assertFailure(root, /forbidden untrusted HTML/);
  }));
});

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-agent-guard-"));
  try {
    fs.cpSync(path.join(sourceRoot, "agents"), path.join(root, "agents"), { recursive: true });
    fs.mkdirSync(path.join(root, "registry"), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "registry", "agents.json"), path.join(root, "registry", "agents.json"));
    fs.copyFileSync(path.join(sourceRoot, "registry", "skills.json"), path.join(root, "registry", "skills.json"));
    fs.mkdirSync(path.join(root, "schemas", "personal-agent"), { recursive: true });
    for (const file of ["agents.schema.json", "agent-profile.schema.json", "agent-workflow.schema.json"]) {
      fs.copyFileSync(path.join(sourceRoot, "schemas", "personal-agent", file), path.join(root, "schemas", "personal-agent", file));
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertFailure(root, pattern) {
  const validation = validateAgentRegistry({ rootDir: root });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), pattern);
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relative.split("/")), "utf8"));
}

function writeJson(root, relative, value) {
  fs.writeFileSync(path.join(root, ...relative.split("/")), `${JSON.stringify(value, null, 2)}\n`);
}
