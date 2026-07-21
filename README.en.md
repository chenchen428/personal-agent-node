# Personal Agent Node

English | [简体中文](README.md)

Personal Agent Node is the open-source, local-first runtime for [Personal Agent](https://personal-agent.cn). Conversations, Agent-owned Activity, account credentials, files, and Agent state stay on your computer. Personal Agent Cloud, a self-hosted public endpoint, and model-token services are all optional.

## Why a local Node

- **Private by design**: application data and long-lived credentials remain in the local data root; Cloud handles enrollment identity, transport, and redacted usage only.
- **Customizable**: compose your own workflows with Skills, Plugins, model providers, and channel adapters.
- **Self-evolving**: improve skills, workflows, and automations within governed permissions and rollback-safe releases.
- **Agent-owned Activity**: the main Agent proactively maintains a readable local account of meaningful work, results, and deliverables.
- **Connectivity freedom**: use local/LAN access, your own domain and tunnel, or the optional Personal Agent Cloud Edge.
- **Model freedom**: use BYOK or an OpenAI-compatible token gateway independently of the selected connectivity mode.

## Everyday use cases

- Collect expenses and bills, then prepare a monthly personal-finance summary.
- Turn itineraries, photos, and notes into travel cards or shareable pages.
- Manage personal platform accounts, drafts, and publishing tasks after explicit approval.
- Continue the same long-running conversation from WeChat or a browser.
- Organize private files, research sources, mail events, and recurring automations.
- Add new capabilities through your own Skills and Plugins.

## Connectivity modes

Personal Agent Node does not require `personal-agent.cn` or any configured Cloud by default:

1. `local-only`: run on the local machine or LAN;
2. `self-hosted-edge`: use your own domain and Edge;
3. `managed-cloud`: use a dedicated domain and managed tunnel from Personal Agent Cloud.

Connectivity and model providers are independent. Disconnecting Cloud must not disable the Local Console, BYOK, Skills, files, automations, Pages, or backups.

## Install a release

Beta users download one complete package for their operating system. No preinstalled Node.js, npm, development Agent, or source checkout is required. The current release is `v0.2.0-beta.30`:

- Windows x86-64: `personal-agent-node-v0.2.0-beta.30-windows-x64-installer.exe`
- macOS Apple Silicon: `personal-agent-node-v0.2.0-beta.30-macos-arm64.pkg`
- macOS Intel: `personal-agent-node-v0.2.0-beta.30-macos-x64.pkg`
- Linux x86-64 / ARM64: the matching `personal-agent-node-v0.2.0-beta.30-linux-*.tar.gz`
- Custom-domain public server: `personal-agent-relay-install.sh` (the client shows the version-bound command)

Starting with a new Release that carries `personal-agent-node-install.sh`, Linux uses a headless `.tar.gz` package, runs continuously as a systemd user service, and ships no Tauri, WebKit, or desktop entry. Replace `<release-tag>` with that Release tag for a one-line install: `curl -fsSL https://github.com/chenchen428/personal-agent-node/releases/download/<release-tag>/personal-agent-node-install.sh | bash`. Use an SSH port forward to open `http://127.0.0.1:8843/app/setup` from your own computer.

The installer verifies the complete immutable release and bundled Node.js `22.23.1` and retains rollback-safe `current` / `previous` pointers. Windows and macOS open Setup Center in the lightweight Tauri 2 shell. Browser and CLI recovery remain available.

Installation has one home: `~/.personal-agent/core` is the replaceable product runtime, while `~/.personal-agent/workspace` holds the user-owned Harness, plugins, files, and data. Uninstall removes Core and preserves Workspace by default.

Local-only mode works by default. A public domain, mail, and WeChat never block the local Console. To verify a public domain and Agent mail identity, choose “Verify public access and mail” in Setup Center, then confirm in an already authenticated `personal-agent.cn` page. One local entrypoint completes Node enrollment and purpose-separated resource authorization, then refreshes the checks automatically. Every failed check includes its reason, concrete next steps, and an available action. See the [getting-started guide](docs/getting-started.md) for signatures, rollback, and source development.

Beta/RC releases may defer paid Windows/macOS native signing, so the operating system can require explicit user approval. Every release still publishes `RELEASE-SECURITY.json`, SHA-256 checksums, Sigstore bundles, provenance, and an SBOM. Stable releases continue to require Authenticode and Apple Developer ID/notarization.

Advanced users may run `personal-agent setup status --json` or `personal-agent doctor --json` for sanitized, read-only diagnostics. Normal installation and repair do not depend on giving a prompt to an Agent.

## Customer-machine Harness

This repository contains the complete customer-machine Agent Harness: project and skill registries, Agent constraints, portable Skills, reproducible fixtures, workspace guards, and runtime workflows. A product installation creates only the canonical workspace and Codex integration. Claude, Cursor, and generic bridges remain source-repository development compatibility, not customer prerequisites.

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

- Keys, tokens, databases, logs, and mutable state belong only in the user-owned `workspace/`; credentials stay under `workspace/secrets/`.
- High-risk operations use digest-bound plans, ten-minute expiry, and explicit local-human approval.
- Edge is a transport plane and does not receive conversation content, private files, business databases, or channel credentials.
- Releases are immutable artifacts with explicit `current` and `previous` upgrade/rollback boundaries.

## License

Apache License 2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components and provenance.
