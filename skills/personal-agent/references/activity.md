# Agent-Owned Activity

Activity is the main Agent's user-facing account of meaningful work. It is not a system event stream, audit log, tool history, notification dump, or hidden memory store.

Only the verified main Agent may run `personal-agent activity ...`. The orchestrator issues an ephemeral capability for the current main-Agent turn. Pass it with `--capability`; never place it in a reply, Activity content, file, log, subtask, or environment configuration. It expires when the turn ends and cannot be delegated to a worker. A session ID, parent ID, `role=main`, API token, loopback access, or CLI flag is not a substitute.

Use `activity search` or `show` before updating an existing story. Prefer `upsert` with a stable `--correlation-key` for ongoing work. Use `create` only for a distinct result or decision. Use optimistic `--expected-revision` for update, hide, and restore.

```text
personal-agent activity search --capability <ephemeral> --query "<topic>" --limit 10 --json
personal-agent activity upsert --capability <ephemeral> --type work --title "<30 chars max>" --detail "<user-facing result and next action>" --idempotency-key "<stable retry key>" --correlation-key "<stable story key>" --json
personal-agent activity update <id> --capability <ephemeral> --expected-revision <n> --detail "<revised user-facing detail>" --json
personal-agent activity hide <id> --capability <ephemeral> --expected-revision <n> --reason "<reason>" --json
personal-agent activity restore <id> --capability <ephemeral> --expected-revision <n> --json
```

Types are `work`, `page`, `mail`, `data`, `automation`, and `note`. Titles are required and limited to 30 visible characters. Details are required. Attachments use repeated `--attachment obj_...` options and are limited to ten total. Never use local paths or arbitrary URLs as attachments.

Create or update Activity proactively when work starts, reaches a useful milestone, produces a deliverable, changes expected outcome, recovers from failure, or completes. Keep one evolving story when frequent updates concern the same work. Do not publish heartbeats, every tool call, token usage, raw database rows, prompts, internal paths, secrets, or implementation chatter.

Activity replaces the legacy product Memory domain. Search Activity to understand recent main-Agent work. Do not call `open-abg memory`, read the legacy table, or recreate a preference/vector-memory side channel.
