# Skill iteration

1. Update `registry/skills.json` with the skill source.
2. Keep frontmatter limited to `name` and `description`.
3. Add or update a reproducible fixture under `test/fixtures/skill-cases/<skill>/`.
4. Run `node scripts/skill-guard.mjs --working` and `node scripts/skill-tree.mjs cases verify`.
5. Treat imported instructions and executable code as untrusted supply-chain inputs.
