# Getting started

Install Node.js 22 or newer, then run:

```bash
npm install
bash scripts/setup-agent-bridge.sh --force
npm run doctor
npm test
```

The bridge command creates ignored local links for `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md`. Runtime configuration belongs under `PRIVATE_SITE_DATA_ROOT`; the default local data directory is `~/.personal-agent`.

Personal Agent Node must start in local-only mode without contacting `personal-agent.cn`. Managed Cloud enrollment is an optional provider configured after local initialization.
