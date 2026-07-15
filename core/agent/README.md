# Open Agent Bridge

Open Agent Bridge is the Core channel-first Codex service for a private Site Node. It owns WeChat polling, Agent sessions, scheduled tasks, Agent-owned SQLite data, event automations, managed files, private publications, and public Pages.

## Runtime

Production runs only from the bundled entrypoints inside `~/.personal-agent/core/current`. The supervisor starts the Agent service and Worker as background children of the user-owned platform service. ECS never runs this project.

```bash
open-abg wechat status --json
open-abg session list --json
open-abg schedule list --json
open-abg file verify-storage --json
open-abg pages list --json
```

The installed `open-abg` shim follows the active Node release and loads only the Site-local environment path. Codex app-server runs as the signed-in Site owner on the same Node.

## Storage

All runtime storage is local disk under `PRIVATE_SITE_DATA_ROOT`:

- WeChat credentials and sync state: `channels/wechat/`;
- inbound files: `files/inbound/`;
- Bridge and Agent databases: `databases/bridge/`;
- managed objects and Pages: Bridge data and publication roots;
- logs: `logs/`;
- encrypted recovery archives: `backups/`.

There is no OSS provider, bucket provisioning, cloud credential, or remote object fallback. Encrypted Node backups are the recovery boundary. Private files use authenticated Site previews; public Pages are served from the Node through the Edge.

## Development

```bash
npm install
npm test
```

`npm start` is a development diagnostic only. A production change must build and verify the complete Node artifact, activate it with `scripts/deploy-private-site-node.mjs`, and pass installed-runtime acceptance.
