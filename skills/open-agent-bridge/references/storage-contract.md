# Local Managed File Contract

## Boundary

- The user Node disk is the only runtime storage provider.
- Files, catalog databases, publications, attachments, materialized paths, and cleanup state stay under `PRIVATE_SITE_DATA_ROOT`.
- Encrypted Node backups provide recovery. There is no OSS bucket, object-storage credential, remote fallback, or cloud garbage-collection path.
- Public Pages are served from the Node through the Edge. Private previews require Site authentication.

## Commands

```bash
open-abg file search --query <text> --tier all --json
open-abg file stat --id <object-id> --json
open-abg file materialize --id <object-id> --ttl 7d --task <task-id> --json
open-abg file pin --id <object-id> --days 30 --reason <reason> --json
open-abg file unpin --id <object-id> --json
open-abg file gc --json
open-abg file verify-storage --json
```

`materialize` verifies and returns an existing local copy or creates a verified local working copy from the Node-managed object root. `pin`, `unpin`, and executable GC affect local files only. `verify-storage` confirms the local root and does not provision an external service.

## Safety

- Prefer an existing verified local path.
- Keep files used by active tasks pinned or leased.
- Run GC and reconciliation as dry runs before `--execute`.
- Never move a private attachment into public Pages to obtain a URL.
- Never include local paths, signed Site URLs, private object identifiers, or file contents in logs or public release records.
