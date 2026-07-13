# Personal Agent Node Agent Guide

This repository is both the public, local-first Personal Agent runtime and the complete customer-machine Agent Harness. Cloud connectivity is optional.

## Startup

1. Read `registry/projects.json` before changing a project, route, port, or runtime.
2. Read `registry/skills.json` before changing a skill or skill-owned CLI.
3. Run `node scripts/discover-projects.mjs list`.
4. Run `node scripts/workspace-doctor.mjs`.
5. Run `node scripts/project-guard.mjs --working` before project or runtime layout changes.
6. Run `node scripts/skill-guard.mjs --working` before skill or fixture changes.
7. Run `bash scripts/setup-agent-bridge.sh --check` when Agent compatibility links matter.
8. Run `bash scripts/install-hooks.sh --check` when repository hooks matter.
9. Read a subproject's `AGENTS.md` when present.

## Boundaries

- Keep credentials, tokens, keys, databases, logs, attachments, and mutable state under ignored `secrets/` or `.local/`. Never print or commit them.
- `projects/core/node` is the customer-machine supervisor and origin gateway.
- `projects/core/open-agent-bridge` owns local Codex sessions, channels, files, mail, schedules, and Pages.
- `projects/core/edge` is the optional self-hosted transport plane. Managed Personal Agent Cloud is only an optional provider.
- Preserve independent domain, tunnel, and Token providers. Local-only plus BYOK must remain functional.
- Top-level `skills/` is the portable skill source. Compatibility paths `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md` are generated locally and ignored.
- Production releases are immutable artifacts. Mutable state must never be packaged into `dist/`.

## Required Checks

```bash
npm run doctor
npm run guard
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```
