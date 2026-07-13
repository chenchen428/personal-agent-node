# Personal Agent Node Agent Guide

This repository is both the public, local-first Personal Agent runtime and the complete customer-machine Agent Harness. Cloud connectivity is optional.

## Startup

1. Read `registry/projects.json` before changing a project, route, port, or runtime.
2. Read `registry/skills.json` before changing a skill or skill-owned CLI.
3. Read `registry/behavior-baselines.json` before changing installation, login, conversation, WeChat, Xiaohongshu, Pages, backup, or rollback behavior.
4. Run `node scripts/discover-projects.mjs list`.
5. Run `node scripts/workspace-doctor.mjs`.
6. Run `node scripts/project-guard.mjs --working` before project or runtime layout changes.
7. Run `node scripts/skill-guard.mjs --working` before skill or fixture changes.
8. Run `bash scripts/setup-agent-bridge.sh --check` when Agent compatibility links matter.
9. Run `bash scripts/install-hooks.sh --check` when repository hooks matter.
10. Read a subproject's `AGENTS.md` when present.

## Boundaries

- Keep credentials, tokens, keys, databases, logs, attachments, and mutable state under ignored `secrets/` or `.local/`. Never print or commit them.
- The only registered product boundaries are Personal Agent Node and optional Private Site Edge. During staged migration their source remains under `projects/core/node`, `projects/core/open-agent-bridge`, `projects/core/admin-panel`, and `projects/core/channels`; these legacy directories are internal Node modules, not independent registered projects.
- `projects/edge` is the optional self-hosted transport plane. Managed Personal Agent Cloud is only an optional provider.
- `registry/capabilities.json`, `routes.json`, `extensions.json`, and `commands.json` are the target architecture contract. Planned or partial status is not full implementation evidence.
- Preserve independent domain, tunnel, and Token providers. Local-only plus BYOK must remain functional.
- Top-level `skills/` is the portable skill source. Compatibility paths `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md` are generated locally and ignored.
- Production releases are immutable artifacts. Mutable state must never be packaged into `dist/`.

## Required Checks

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```
