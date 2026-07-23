import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseSkillFrontmatter, readWorkspaceSkillCatalog } from "../src/skills/catalog.js";

test("parses plain, quoted, and folded skill descriptions", () => {
  assert.deepEqual(parseSkillFrontmatter("---\nname: plain\ndescription: Plain description.\n---\n"), {
    name: "plain",
    description: "Plain description.",
  });
  assert.equal(parseSkillFrontmatter("---\nname: quoted\ndescription: \"Quoted description.\"\n---\n").description, "Quoted description.");
  assert.equal(parseSkillFrontmatter("---\nname: folded\ndescription: >\n  First line.\n  Second line.\n---\n").description, "First line. Second line.");
});

test("discovers skills from the skills directory and enriches registered entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-skill-catalog-"));
  try {
    fs.mkdirSync(path.join(root, "registry"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "gamma"), { recursive: true });
    fs.writeFileSync(path.join(root, "registry", "skills.json"), JSON.stringify({
      categories: [
        { id: "second", label: "Second", order: 20 },
        { id: "first", label: "First", order: 10 },
      ],
      skills: [
        { name: "alpha", directory: "skills/alpha", category: "first", maturity: "stable", risks: [], security: { network: "none" }, origin: { kind: "workspace" }, cli: ["alpha"], examples: [], caseRequired: false, related: [] },
        { name: "removed", directory: "skills/removed", category: "second", maturity: "beta", risks: ["network-read"], security: { network: "read" }, origin: { kind: "adapted" }, cli: [], examples: ["removed.json"], caseRequired: true, related: ["alpha"] },
      ],
    }));
    fs.writeFileSync(path.join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha description.\n---\n");
    fs.writeFileSync(path.join(root, "skills", "gamma", "SKILL.md"), "---\nname: gamma\ndescription: >\n  Gamma first line.\n  Gamma second line.\n---\n");

    const catalog = readWorkspaceSkillCatalog(root);
    assert.deepEqual(catalog.categories.map((category) => category.id), ["first", "second", "uncategorized"]);
    assert.deepEqual(catalog.skills.map((skill) => skill.name), ["alpha", "gamma"]);
    assert.equal(catalog.skills[1].description, "Gamma first line. Gamma second line.");
    assert.deepEqual(catalog.skills[0].cli, ["alpha"]);
    assert.equal(catalog.skills[0].directory, "skills/alpha");
    assert.equal(catalog.skills[1].directory, "skills/gamma");
    assert.equal(catalog.skills[1].category, "uncategorized");
    assert.deepEqual(catalog.skills[1].risks, []);
    assert.deepEqual(catalog.skills[1].security, {});
    assert.equal(catalog.skills[1].caseRequired, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reads the skills directory again when a skill is added", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-skill-refresh-"));
  try {
    fs.mkdirSync(path.join(root, "registry"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(root, "registry", "skills.json"), JSON.stringify({ categories: [], skills: [] }));
    fs.writeFileSync(path.join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha.\n---\n");
    assert.deepEqual(readWorkspaceSkillCatalog(root).skills.map((skill) => skill.name), ["alpha"]);

    fs.mkdirSync(path.join(root, "skills", "beta"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: Beta.\n---\n");
    assert.deepEqual(readWorkspaceSkillCatalog(root).skills.map((skill) => skill.name), ["alpha", "beta"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
