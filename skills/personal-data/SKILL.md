---
name: personal-data
description: Inspect and query current-Space Personal Agent data through pa-cli data. Use for data status, schema discovery, safe SQL or structured queries, metadata, snapshots, restore planning, aggregates, pagination, or explaining locally governed data results.
---

# Personal Data

Start read-only:

```text
pa-cli data status --json
pa-cli data schema --json
pa-cli data query --object <table> --json
```

Use structured `data query` when it can express the request. Use `data sql` only against the governed data capability, never by opening the database directly. Keep result fields and row counts bounded and do not expose unrelated private rows.

Create a snapshot before a mutation when supported. `snapshot` is a local write. Restore is destructive/recovery work and requires the user's explicit target plus the exact approved operation. Verify status after every write or restore.

Read [data-commands.md](references/data-commands.md) for command selection and risk boundaries.
