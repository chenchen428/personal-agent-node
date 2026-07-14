# Personal Agent Node

English | [简体中文](README.md)

Personal Agent Node is an open-source, local-first runtime for a private personal assistant. Conversations, long-term memory, account credentials, files, and Agent state stay on your computer. Personal Agent Cloud, a self-hosted public endpoint, and model-token services are all optional.

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

Personal Agent Node does not require `personal-agent.cn` by default:

1. `local-only`: run on the local machine or LAN;
2. `self-hosted-edge`: use your own domain and Edge;
3. `managed-cloud`: use a dedicated domain and managed tunnel from Personal Agent Cloud.

Connectivity and model providers are independent. Disconnecting Cloud must not disable the Local Console, BYOK, Skills, files, automations, Pages, or backups.

## Get started

The current beta development environment requires Node.js 22.x. Node 24 removed the permission-model flag used by the template sandbox and is not supported yet.

```bash
git clone https://github.com/chenchen428/personal-agent-node.git
cd personal-agent-node
npm install
npm run doctor
```

See the [getting-started guide](docs/getting-started.md) for development bootstrap and local initialization. End users should install an immutable GitHub Release artifact rather than use a source checkout as the production runtime.

After registering with Personal Agent Cloud and receiving an operator-assigned domain, connect with:

```bash
personal-agent cloud connect --json
```

The CLI opens a short-lived authorization page on `personal-agent.cn` and exposes only a verification URL and user code. After browser confirmation, it consumes a one-time enrollment credential. The long-lived Node token is never shown in the browser, terminal output, or `cloud.json`.

Release and final Node acceptance use the GitHub Release installation's authenticated local `/app/chat`: send a unique prompt to the real Agent runtime and verify the Agent reply in the same session. Canonical evidence always records `wechatRequired=false`; WeChat is optional and never blocks the Node core gate.

## Customer-machine Harness

This repository contains the complete customer-machine Agent Harness: project and skill registries, Agent constraints, portable Skills, reproducible fixtures, workspace guards, runtime workflows, and compatibility bridges for Codex, Claude, Cursor, and generic Agent clients.

```bash
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
