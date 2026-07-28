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

test("refreshes product-managed page skills and registries without replacing user skills", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-page-capability-seed-"));
  try {
    const releaseRoot = path.join(root, "release");
    const agentWorkspaceRoot = path.join(root, "space", "agent-workspace");
    const dataRoot = path.join(root, "space");
    for (const skill of ["interior-design", "personal-pages"]) {
      fs.mkdirSync(path.join(releaseRoot, "workspace", "skills", skill), { recursive: true });
      fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", skill), { recursive: true });
      fs.writeFileSync(path.join(releaseRoot, "workspace", "skills", skill, "SKILL.md"), `new ${skill}\n`);
      fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", skill, "SKILL.md"), `old ${skill}\n`);
      fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", skill, "removed.txt"), "removed product file\n");
    }
    fs.mkdirSync(path.join(agentWorkspaceRoot, "skills", "user-skill"), { recursive: true });
    fs.writeFileSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md"), "user skill\n");
    fs.mkdirSync(path.join(releaseRoot, "workspace", "registry"), { recursive: true });
    fs.mkdirSync(path.join(agentWorkspaceRoot, "registry"), { recursive: true });
    for (const file of ["interior-design.json", "page-templates.json", "skills.json"]) {
      fs.writeFileSync(path.join(releaseRoot, "workspace", "registry", file), `new ${file}\n`);
      fs.writeFileSync(path.join(agentWorkspaceRoot, "registry", file), `old ${file}\n`);
    }

    const result = seedAgentWorkspace({ agentWorkspaceRoot, dataRoot }, { releaseRoot });
    assert.equal(result.refreshed, 5);
    assert.deepEqual(result.refreshedPaths, [
      "skills/interior-design",
      "skills/personal-pages",
      "registry/interior-design.json",
      "registry/page-templates.json",
      "registry/skills.json",
    ]);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "SKILL.md"), "utf8"), "new interior-design\n");
    assert.equal(fs.existsSync(path.join(agentWorkspaceRoot, "skills", "interior-design", "removed.txt")), false);
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "skills", "user-skill", "SKILL.md"), "utf8"), "user skill\n");
    assert.equal(fs.readFileSync(path.join(agentWorkspaceRoot, "registry", "page-templates.json"), "utf8"), "new page-templates.json\n");

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
