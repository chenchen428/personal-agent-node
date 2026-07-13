# Getting started

Install Node.js 22.x, then run:

```bash
npm install
bash scripts/setup-agent-bridge.sh --force
npm run doctor
npm test
```

The bridge command creates ignored local links for `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md`. Runtime configuration belongs under `PRIVATE_SITE_DATA_ROOT`; the default local data directory is `~/.personal-agent`.

Personal Agent Node must start in local-only mode without contacting `personal-agent.cn`. Managed Cloud enrollment is an optional provider configured after local initialization.

For the managed Free Edge path, install a verified GitHub Release and start the loopback-only setup page:

```bash
node scripts/install-from-github-release.mjs --tag v0.1.0-beta.3
node ~/.private-site-node/current/projects/core/node/bin/private-site.mjs onboarding
```

Open `http://127.0.0.1:8842/`, then enter the invitation email, authorization code, and desired slug. The Node exchanges the authorization code for a short-lived device code, enrolls the local device, verifies a heartbeat, stores the Node token only in the mode-600 local secret file, prepares the installed release, and starts the supervisor in the background.
