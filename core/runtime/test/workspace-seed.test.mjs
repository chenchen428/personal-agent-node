import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  copyMissingTree,
  PERSONAL_AGENT_SPLIT_SKILLS,
  seedAgentWorkspace,
} from "../src/workspace-seed.ts";

test("copies new seed files without replacing existing user content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-seed-copy-"));
  try {
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    fs.mkdirSync(path.join(source, "existing"), { recursive: true });
    fs.mkdirSync(path.join(source, "new-skill"), { recursive: true });
    fs.mkdirSync(path.join(target, "existing"), { recursive: true });
    fs.mkdirSync(path.join(target, "user-skill"), { recursive: true });
    fs.writeFileSync(path.join(source, "existing", "SKILL.md"), "release version\n");
    fs.writeFileSync(path.join(source, "existing", "new-reference.md"), "new reference\n");
    fs.writeFileSync(path.join(source, "new-skill", "SKILL.md"), "new skill\n");
    fs.writeFileSync(path.join(target, "existing", "SKILL.md"), "user version\n");
    fs.writeFileSync(path.join(target, "user-skill", "SKILL.md"), "user skill\n");

    assert.equal(copyMissingTree(source, target), 2);
    assert.equal(fs.readFileSync(path.join(target, "existing", "SKILL.md"), "utf8"), "user version\n");
    assert.equal(fs.readFileSync(path.join(target, "existing", "new-reference.md"), "utf8"), "new reference\n");
    assert.equal(fs.readFileSync(path.join(target, "new-skill", "SKILL.md"), "utf8"), "new skill\n");
    assert.equal(fs.readFileSync(path.join(target, "user-skill", "SKILL.md"), "utf8"), "user skill\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refreshes the interior delivery capability and retires the removed Page template product layer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-page-capability-seed-"));
  try {
    const releaseRoot = path.join(root, "release");
    const agentWorkspaceRoot = path.join(root, "space", "agent-workspace");
    const dataRoot = path.join(root, "space");
    fs.mkdirSync(path.join(releaseRoot, "workspace", "skills", "interior-design"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "interior-design"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "personal-pages"), { recursive: true });
    fs.writeFileSync(path.join(releaseRoot, "workspace", "skills", "interior-design", "SKILL.md"), "new interior-design\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "SKILL.md"), "old interior-design\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "removed.txt"), "removed product file\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "personal-pages", "SKILL.md"), "retired personal-pages\n");
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "user-skill"), { recursive: true });
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md"), "user skill\n");
    fs.mkdirSync(path.join(releaseRoot, "workspace", "registry"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "registry"), { recursive: true });
    for (const file of ["interior-design.json", "skills.json"]) {
      fs.writeFileSync(path.join(releaseRoot, "workspace", "registry", file), `new ${file}\n`);
      fs.writeFileSync(path.join(agentWorkspaceRoot, "registry", file), `old ${file}\n`);
    }
    fs.writeFileSync(path.join(agentWorkspaceRoot, "registry", "page-templates.json"), "retired page templates\n");

    const result = seedAgentWorkspace(
      { agentWorkspaceRoot, dataRoot },
      { releaseRoot, now: () => new Date("2026-07-30T01:02:03.000Z") },
    );
    assert.equal(result.refreshed, 3);
    assert.deepEqual(result.refreshedPaths, [
      "skills/interior-design",
      "registry/interior-design.json",
      "registry/skills.json",
    ]);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "SKILL.md"), "utf8"), "new interior-design\n");
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "removed.txt")), false);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md"), "utf8"), "user skill\n");
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "personal-pages")), false);
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "registry", "page-templates.json")), false);
    assert.equal(result.retiredSkills.length, 1);
    assert.equal(result.retiredRegistries.length, 1);
    assert.equal(fs.readFileSync(path.join(dataRoot, result.retiredSkills[0], "SKILL.md"), "utf8"), "retired personal-pages\n");
    assert.equal(fs.readFileSync(path.join(dataRoot, result.retiredRegistries[0]), "utf8"), "retired page templates\n");

    const repeated = seedAgentWorkspace({ agentWorkspaceRoot, dataRoot }, { releaseRoot });
    assert.equal(repeated.refreshed, 0);
    assert.deepEqual(repeated.refreshedPaths, []);
    assert.deepEqual(repeated.retiredSkills, []);
    assert.deepEqual(repeated.retiredRegistries, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refreshes product-managed Agent sources, schemas, registry, and guard on upgrade", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-agent-source-seed-"));
  try {
    const releaseRoot = path.join(root, "release");
    const seedRoot = path.join(releaseRoot, "workspace");
    const agentWorkspaceRoot = path.join(root, "space", "agent-workspace");
    const dataRoot = path.join(root, "space");
    const managedFiles = [
      "registry/agents.json",
      "schemas/personal-agent/agents.schema.json",
      "schemas/personal-agent/agent-profile.schema.json",
      "scripts/agent-guard.mjs",
    ];

    fs.mkdirSync(path.join(seedRoot, "agents", "interior-designer"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "agents", "interior-designer"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "agents", "custom-agent"), { recursive: true });
    fs.writeFileSync(path.join(seedRoot, "agents", "interior-designer", "agent.yaml"), "new Agent config\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "agents", "interior-designer", "agent.yaml"), "old Agent config\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "agents", "interior-designer", "removed.txt"), "removed product file\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "agents", "custom-agent", "agent.yaml"), "user Agent config\n");
    for (const agentId of ["poster-designer", "travel-planner", "finance-analyst"]) {
      fs.mkdirSync(path.join(seedRoot, "agents", agentId), { recursive: true });
      fs.writeFileSync(path.join(seedRoot, "agents", agentId, "agent.yaml"), `new ${agentId} config\n`);
    }
    for (const relative of managedFiles) {
      fs.mkdirSync(path.dirname(path.join(seedRoot, relative)), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(agentWorkspaceRoot, relative)), { recursive: true });
      fs.writeFileSync(path.join(seedRoot, relative), `new ${relative}\n`);
      fs.writeFileSync(path.join(agentWorkspaceRoot, relative), `old ${relative}\n`);
    }

    const result = seedAgentWorkspace({ agentWorkspaceRoot, dataRoot }, { releaseRoot });
    assert.equal(result.refreshed, 5);
    assert.deepEqual(result.refreshedPaths, [
      "agents/interior-designer",
      "registry/agents.json",
      "schemas/personal-agent/agents.schema.json",
      "schemas/personal-agent/agent-profile.schema.json",
      "scripts/agent-guard.mjs",
    ]);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "agents", "interior-designer", "agent.yaml"), "utf8"), "new Agent config\n");
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "agents", "interior-designer", "removed.txt")), false);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "agents", "custom-agent", "agent.yaml"), "utf8"), "user Agent config\n");
    for (const agentId of ["poster-designer", "travel-planner", "finance-analyst"]) {
      assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "agents", agentId, "agent.yaml"), "utf8"), `new ${agentId} config\n`);
    }
    for (const relative of managedFiles) {
      assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, relative), "utf8"), `new ${relative}\n`);
    }

    const repeated = seedAgentWorkspace({ agentWorkspaceRoot, dataRoot }, { releaseRoot });
    assert.equal(repeated.refreshed, 0);
    assert.deepEqual(repeated.refreshedPaths, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("seeds split skills and recoverably retires the legacy personal-agent skill", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-seed-upgrade-"));
  try {
    const releaseRoot = path.join(root, "release");
    const agentWorkspaceRoot = path.join(root, "space", "agent-workspace");
    const dataRoot = path.join(root, "space");
    fs.mkdirSync(path.join(releaseRoot, "workspace", "skills"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "personal-agent"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "user-skill"), { recursive: true });
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "personal-agent", "SKILL.md"), "user-adjusted legacy skill\n");
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md"), "user skill\n");
    fs.writeFileSync(path.join(releaseRoot, "workspace", "AGENTS.md"), "# Workspace\n");
    for (const name of PERSONAL_AGENT_SPLIT_SKILLS) {
      fs.mkdirSync(path.join(releaseRoot, "workspace", "skills", name), { recursive: true });
      fs.writeFileSync(path.join(releaseRoot, "workspace", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}.\n---\n`);
    }

    const result = seedAgentWorkspace(
      { agentWorkspaceRoot, dataRoot },
      { releaseRoot, now: () => new Date("2026-07-23T12:34:56.000Z") },
    );
    assert.equal(result.retiredSkills.length, 1);
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "personal-agent")), false);
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "personal-memory", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md")), true);
    assert.equal(fs.readFileSync(path.join(dataRoot, result.retiredSkills[0], "SKILL.md"), "utf8"), "user-adjusted legacy skill\n");
    assert.equal(fs.realpathSync(path.join(agentWorkspaceRoot, ".codex", "skills")), fs.realpathSync(path.join(agentWorkspaceRoot, "skills")));

    const repeated = seedAgentWorkspace(
      { agentWorkspaceRoot, dataRoot },
      { releaseRoot, now: () => new Date("2026-07-23T12:35:00.000Z") },
    );
    assert.deepEqual(repeated.retiredSkills, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
