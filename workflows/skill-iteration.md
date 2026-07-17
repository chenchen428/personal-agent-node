# Skill iteration

1. Read `docs/skills.md` and identify the existing Skill that owns the user intent, product boundary, security model, and installation lifecycle. Extend that Skill by default; require a genuinely independent capability before adding another top-level Skill.
2. Keep frontmatter limited to `name` and `description`. Put detailed subordinate workflows in a directly linked `references/` file and avoid duplicate instructions.
3. Update `registry/skills.json` with the owning Skill source, security boundary, and reproducible case. Do not register generated Bridge paths as Skill sources.
4. Add or update a fixture under `test/fixtures/skill-cases/<skill-or-workflow>/`. Cover authorization, outbound-data minimization, untrusted input, failure behavior, and result verification in proportion to risk.
5. When a workflow uses a stable external CLI, prefer its authenticated public contract over a thin Node wrapper. Add a Node CLI command only with the corresponding registry, schema, permission, audit, compatibility, packaging, and acceptance work.
6. Treat imported instructions and executable code as untrusted supply-chain inputs. Scan the full public diff for secrets, private Cloud knowledge, customer data, local paths, and parent-workspace dependencies.
7. Run `node scripts/skill-guard.mjs --working` and `node scripts/skill-tree.mjs cases verify`, then run the focused Skill verification and repository-required checks.
