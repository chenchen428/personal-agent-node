# private-site-node

`private-site-node` is the local-first lifecycle controller and origin gateway for one complete private Site. It owns the local data root and starts Open Agent Bridge, its Worker, the workspace administration site, optional extensions, and the fixed-host gateway as one consistency boundary. The universal release does not contain the personal `lmt_tools` extension.

The public Edge is optional for local operation. Site application data and channel credentials are never required by the Edge.

```powershell
npm install
node bin/private-site.mjs init --domain personal-agent.local
node bin/private-site.mjs prepare
node bin/private-site.mjs daemon-start
node bin/private-site.mjs verify --json
```

For a public self-hosted Site, install OpenSSL and WireGuard, copy the bootstrap
example into ignored `secrets/`, and let Codex run:

```powershell
node scripts/bootstrap-private-site.mjs plan --config secrets/bootstrap.json
node scripts/bootstrap-private-site.mjs apply --config secrets/bootstrap.json
node scripts/bootstrap-private-site.mjs verify --config secrets/bootstrap.json
```

The Node generates both private keys locally. The user owns the ECS, domain, SSH
key, and Aliyun AKSK. Codex is the only supported Agent runtime in the current
version and works from the complete cloned repository.

`PERSONAL_AGENT_AUTH_PASSWORD` must be present in the private Site environment before startup. Other generated secrets are created during `init`. The environment file and all mutable state live outside immutable releases under `PRIVATE_SITE_DATA_ROOT`.

The supervisor creates one online encrypted backup every 24 hours and retains
seven automatic archives by default. SQLite files use database-aware snapshots.
The recovery key lives outside the Site data root under the user's private
recovery directory and is never included in an archive. Inspect the current state
with `private-site status --json` or trigger the governed scheduler path with:

```powershell
node bin/private-site.mjs backup --scheduled
```

Set `PRIVATE_SITE_BACKUP_ENABLED=0` only for an intentional opt-out. The bounded
overrides are `PRIVATE_SITE_BACKUP_INTERVAL_HOURS` and
`PRIVATE_SITE_BACKUP_RETENTION_COUNT`. Scheduled backups exclude credentials and
channel sessions unless `PRIVATE_SITE_BACKUP_FULL_RECOVERY=1` is explicitly set.

Restore verification never activates data. A real restore writes only to an empty,
inactive data root:

```powershell
node bin/private-site.mjs restore-apply --archive <backup.psb> --key-file <recovery.key> --target <empty-data-root>
```

For a replacement machine, create a protected backup with `backup
--full-recovery`, then add `--replacement` to `restore-apply`. This preserves the
Site and domain, creates a new Node ID, removes restored origin/WireGuard private
identity, and writes `config/replacement.json`. Set `replacement: true` in the
ignored bootstrap config; bootstrap then replaces and archives the old Edge peer
before activating the new Node. A data-only backup is intentionally rejected for
replacement activation.
