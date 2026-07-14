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
node scripts/install-from-github-release.mjs --tag v0.1.0-beta.11
personal-agent cloud connect --json
```

The release installer verifies checksums, switches the immutable `current` pointer, then explicitly prepares the data root. Fresh installs and upgrades both provision a missing local mail-ingress token, render current-following CLI shims and non-destructively copy legacy `mail-ingress/` data into `mail/` while retaining the old source for rollback. Use `--data-root <path>` when the Node does not use the default `~/.personal-agent` data root.

The CLI opens the short-lived authorization page on `personal-agent.cn` and prints a user code plus fallback URL. Sign in with the registered email account, confirm the Site assigned by the administrator, and return to the terminal. The CLI polls for a one-time enrollment credential, enrolls the local device, verifies a heartbeat, and stores the long-lived Node token only in the mode-600 local secret file. It never prints that credential or token.

Final Node acceptance uses the GitHub Release installation's authenticated local `/app/chat`: send a unique prompt to the real Agent runtime and verify the Agent reply in the same session. Canonical evidence records `releaseAssetRuntime=true`, `route=/app/chat`, `authenticated=true`, `uniquePrompt=true`, `realAgentRuntime=true`, `sameSessionAgentReply=true`, and `wechatRequired=false`; it stores no prompt, reply or session identifier.

## Discover CLI capabilities

The public CLI reports capability maturity instead of presenting roadmap commands as available:

```bash
personal-agent help --json           # implemented commands only
personal-agent help --preview --json # implemented and preview commands
personal-agent help --all --json     # implemented, preview, and planned metadata
```

Preview execution requires an explicit `--preview` flag and returns a `PREVIEW_COMMAND` warning. `--all` works only with help and never enables planned commands. Planned and unknown commands fail closed with `CAPABILITY_UNAVAILABLE`.
