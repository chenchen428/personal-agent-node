# Getting started

Install Node.js 22.x, then run:

```bash
npm install
bash scripts/setup-agent-bridge.sh --force
npm run doctor
npm test
```

The bridge command creates ignored local links for `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md`. Runtime configuration belongs under `PRIVATE_SITE_DATA_ROOT`; the default local data directory is `~/.personal-agent`.

Personal Agent Node must start in local-only mode without contacting `personal-agent.cn`. Managed Cloud enrollment is an optional provider selected explicitly by the user.

For the managed Free Edge path, install a verified GitHub Release and run the installed CLI:

```bash
node scripts/install-from-github-release.mjs --tag v0.1.0-beta.6
personal-agent cloud connect --json
```

The CLI opens the short-lived authorization page on `personal-agent.cn` and prints a user code plus fallback URL. Sign in with the registered email account, confirm the Site assigned by the administrator, and return to the terminal. The CLI polls for a one-time enrollment credential, enrolls the local device, verifies a heartbeat, and stores the long-lived Node token only in the mode-600 local secret file. It never prints that credential or token.
