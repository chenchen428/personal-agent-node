# Personal Agent Node

English | [简体中文](README.md)

Personal Agent Node is the open-source, local-first runtime for [Personal Agent](https://chenjianhui.site). Conversations, long-term memory, account credentials, files, and Agent state stay on your computer. Personal Agent Cloud, a self-hosted public endpoint, and model-token services are all optional.

## Why a local Node

- **Private by design**: application data and long-lived credentials remain in the local data root; Cloud handles enrollment identity, transport, and redacted usage only.
- **Customizable**: compose your own workflows with Skills, Extensions, model providers, and channel adapters.
- **Self-evolving**: improve skills, workflows, and automations within governed permissions and rollback-safe releases.
- **Long-term memory**: persist conversations, files, plans, and personal knowledge beyond a temporary browser session.
- **Connectivity freedom**: use local/LAN access, your own domain and tunnel, or the optional Personal Agent Cloud Edge.
- **Model freedom**: use BYOK or an OpenAI-compatible token gateway independently of the selected connectivity mode.

## Everyday use cases

- Collect expenses and bills, then prepare a monthly personal-finance summary.
- Turn itineraries, photos, and notes into travel cards or shareable pages.
- Manage personal platform accounts, drafts, and publishing tasks after explicit approval.
- Continue the same long-running conversation from WeChat or a browser.
- Organize private files, research sources, mail events, and recurring automations.
- Add new capabilities through your own Skills and Extensions.

## Connectivity modes

Personal Agent Node does not require `chenjianhui.site` or any configured Cloud by default:

1. `local-only`: run on the local machine or LAN;
2. `self-hosted-edge`: use your own domain and Edge;
3. `managed-cloud`: use a dedicated domain and managed tunnel from Personal Agent Cloud.

Connectivity and model providers are independent. Disconnecting Cloud must not disable the Local Console, BYOK, Skills, files, automations, Pages, or backups.

## Install a release

The current beta requires Node.js 22.x. Node 24 removed the permission-model flag used by the template sandbox and is not supported yet. End users should install an immutable GitHub Release instead of using a source checkout as their production runtime.

macOS / Linux:

```bash
TAG=v0.1.0-beta.19
INSTALLER="$(mktemp "${TMPDIR:-/tmp}/personal-agent-installer.XXXXXX.mjs")"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$INSTALLER" -- \
  "https://github.com/chenchen428/personal-agent-node/releases/download/$TAG/personal-agent-node-$TAG-installer.mjs"
node "$INSTALLER" --tag "$TAG"
rm -f "$INSTALLER"
export PATH="$HOME/.local/bin:$PATH"
personal-agent doctor --json
```

Windows PowerShell:

```powershell
$Tag = "v0.1.0-beta.19"
$Installer = Join-Path $env:TEMP "personal-agent-$Tag-installer.mjs"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/chenchen428/personal-agent-node/releases/download/$Tag/personal-agent-node-$Tag-installer.mjs" -OutFile $Installer
node $Installer --tag $Tag
Remove-Item $Installer
& "$env:APPDATA\npm\personal-agent.cmd" doctor --json
```

The standalone bootstrapper needs neither a source checkout nor `npm install`. It downloads only the requested tag, verifies the archive against the Release `SHA256SUMS`, and then switches immutable `current` / `previous` pointers. See the [getting-started guide](docs/getting-started.md) for source development, custom data roots, and platform details.

## Register and attach a dedicated domain

First register at [chenjianhui.site](https://chenjianhui.site) with an email verification code. After an administrator assigns your dedicated domain, run this on the same computer where Node is installed:

```bash
personal-agent cloud connect --json
```

The CLI opens a short-lived authorization page on `chenjianhui.site` and exposes only a verification URL and user code. Sign in with the same account, verify the dedicated domain, and approve it in the browser. The CLI then consumes a one-time enrollment credential, registers this machine, verifies its heartbeat, and completes the attachment. Do not treat the user code as a long-lived credential or send it through chat. The long-lived Node token, generated local password, and tunnel secrets are never shown in the browser, terminal output, or `cloud.json`.

The managed Cloud origin is configurable. `PERSONAL_AGENT_CLOUD_URL=https://cloud.example` changes the default for the current process, while `personal-agent cloud connect --cloud-url https://cloud.example --json` is an explicit per-command override and takes priority over the environment. Custom origins must use HTTPS.

If the browser does not open, copy `verificationUrlComplete` from the terminal. Expired, denied, or account/Site-mismatched authorization fails closed; rerun the command to start a new short-lived flow.

### Copyable one-click Agent prompt

After signing in to the website, you can give the following prompt to an Agent running on your computer. It contains only public release and CLI instructions—never an account, verification code, or secret:

> Install Personal Agent Node v0.1.0-beta.19 on this computer. First confirm that Node.js is 22.x. Download only `personal-agent-node-v0.1.0-beta.19-installer.mjs` from the `chenchen428/personal-agent-node` GitHub Release and pass `--tag v0.1.0-beta.19` explicitly; do not clone the source repository as the runtime. After SHA256 verification, add the CLI directory to PATH, run `personal-agent doctor --json`, and immediately open the local Console to bind WeChat. The channel will report the domain, mail, managed-mail, and configuration states. Then run `personal-agent cloud connect --json` and let me personally sign in with GitHub and approve my dedicated domain. Never ask for, repeat, or retain a device code, one-time enrollment credential, Node token, local password, or tunnel secret. If Cloud resources are bound through WeChat, send only `云账号绑定`, then let me approve the passwordless resource authorization in the same-origin browser; no GitHub user ID or password is required. Finally run `personal-agent status --json` and report only redacted release, connection mode, domain, mail, capability, and health state.

Release and final Node acceptance use the GitHub Release installation's authenticated local `/app/chat`: send a unique prompt to the real Agent runtime and verify the Agent reply in the same session. Canonical evidence always records `wechatRequired=false`; WeChat is optional and never blocks the Node core gate.

## Customer-machine Harness

This repository contains the complete customer-machine Agent Harness: project and skill registries, Agent constraints, portable Skills, reproducible fixtures, workspace guards, runtime workflows, and compatibility bridges for Codex, Claude, Cursor, and generic Agent clients.

```bash
npm install
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```

## Security boundaries

- Keys, tokens, databases, logs, and mutable state belong only in ignored `.local/`, `secrets/`, or the configured data root.
- High-risk operations use digest-bound plans, ten-minute expiry, and explicit local-human approval.
- Edge is a transport plane and does not receive conversation content, private files, business databases, or channel credentials.
- Releases are immutable artifacts with explicit `current` and `previous` upgrade/rollback boundaries.

## License

Apache License 2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components and provenance.
