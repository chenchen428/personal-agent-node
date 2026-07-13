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

test("reads the canonical skill registry and SKILL descriptions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-skill-catalog-"));
  try {
    fs.mkdirSync(path.join(root, "registry"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "beta"), { recursive: true });
    fs.writeFileSync(path.join(root, "registry", "skills.json"), JSON.stringify({
      categories: [
        { id: "second", label: "Second", order: 20 },
        { id: "first", label: "First", order: 10 },
      ],
      skills: [
        { name: "beta", directory: "skills/beta", category: "second", maturity: "beta", cli: [], related: ["alpha"] },
        { name: "alpha", directory: "skills/alpha", category: "first", maturity: "stable", cli: ["alpha"], related: [] },
      ],
    }));
    fs.writeFileSync(path.join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha description.\n---\n");
    fs.writeFileSync(path.join(root, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: >\n  Beta first line.\n  Beta second line.\n---\n");

    const catalog = readWorkspaceSkillCatalog(root);
    assert.deepEqual(catalog.categories.map((category) => category.id), ["first", "second"]);
    assert.deepEqual(catalog.skills.map((skill) => skill.name), ["alpha", "beta"]);
    assert.equal(catalog.skills[1].description, "Beta first line. Beta second line.");
    assert.deepEqual(catalog.skills[0].cli, ["alpha"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
