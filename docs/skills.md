# Skills

`registry/skills.json` is the authoritative skill catalog and top-level `skills/` is the portable source installed on a customer machine. The universal set covers structured research, source capture, content preparation, visual planning, deterministic media processing, and Open Agent Bridge operations. Every active skill has `SKILL.md`, Agent UI metadata, provenance and security declarations, and a reproducible case under `test/fixtures/skill-cases/`.

Owner-specific deployment, personal-site publishing, private channels, and credential-bearing skills are intentionally excluded. Run `node scripts/skill-tree.mjs catalog` to inspect the installed set.
