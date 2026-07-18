# Agent-Owned Activity

Activity is the main Agent's user-facing account of meaningful work. It is not a system event stream, audit log, tool history, notification dump, or hidden memory store.

Only the verified main Agent may run `personal-agent activity ...`. The orchestrator issues an ephemeral capability for the current main-Agent turn. Pass it with `--capability`; never place it in a reply, Activity content, file, log, subtask, or environment configuration. It expires when the turn ends and cannot be delegated to a worker. A session ID, parent ID, `role=main`, API token, loopback access, or CLI flag is not a substitute.

Use `activity search` or `show` before updating an existing story. Prefer `upsert` with a stable `--correlation-key` for ongoing work. Use `create` only for a distinct result or decision. Use optimistic `--expected-revision` for update, hide, and restore.

```text
personal-agent activity search --capability <ephemeral> --query "<topic>" --limit 10 --json
personal-agent activity upsert --capability <ephemeral> --type work --title "<30 chars max>" --detail "<user-facing result and next action>" --idempotency-key "<stable retry key>" --correlation-key "<stable story key>" --json
personal-agent activity upsert --capability <ephemeral> --type page --title "<30 chars max>" --detail "<user-facing Page result>" --target-type page --target-id "<pageId returned by pa-cli pages publish>" --idempotency-key "<stable retry key>" --correlation-key "<stable story key>" --json
personal-agent activity update <id> --capability <ephemeral> --expected-revision <n> --detail "<revised user-facing detail>" --json
personal-agent activity hide <id> --capability <ephemeral> --expected-revision <n> --reason "<reason>" --json
personal-agent activity restore <id> --capability <ephemeral> --expected-revision <n> --json
```

Types are `work`, `page`, `mail`, `data`, `automation`, and `note`. Titles are required and limited to 30 visible characters. Details are required. Attachments use repeated `--attachment obj_...` options and are limited to ten total. Never use local paths or arbitrary URLs as attachments.

When an Activity has a user-visible detail object, provide `--target-type` and `--target-id` together so the Activity card opens that object. Page Activity is stricter: it must use `--target-type page` and the stable `pageId` returned by `pa-cli pages publish`. Never substitute the Page URL, share URL, folder, local path, or a guessed client route for that ID.

## What Makes A Good Activity

A good Activity is useful on its own and remains useful when revisited later:

- **Outcome:** the title and detail say what the user received or what materially changed, not merely that a process ended.
- **Meaning:** the detail explains why the result matters and any limitation that changes how it should be used.
- **Next action:** when the user can continue, review, download, approve, or correct something, say so plainly.
- **Destination:** when a task, Page, mail item, data object, App, or other governed object owns the full result, set that stable target so the card opens it. Do not knowingly publish a dead result card.
- **Representative media:** let a Page target supply its stored device-appropriate thumbnail. Use Activity attachments only for explicit managed objects reported in Work artifact information; never scrape arbitrary HTML or promote remote image URLs.
- **One evolving story:** use a stable correlation key and update the existing story unless a distinct deliverable, decision, failure, or recovery deserves its own entry.

When a Work completes, consume its `<personal-agent-artifacts>` envelope before writing Activity. Prefer the artifact the user is most likely to revisit. A published report is normally a `page` Activity targeted at its `pageId`; if there is no independent governed artifact, use a `work` Activity targeted at the envelope's `work.id`. Attach only the reported ready `obj_...` IDs. The Work reports artifact facts; the main Agent remains the sole author of the Activity wording and lifecycle.

Create or update Activity proactively when work starts, reaches a useful milestone, produces a deliverable, changes expected outcome, recovers from failure, or completes. Keep one evolving story when frequent updates concern the same work. Do not publish heartbeats, every tool call, token usage, raw database rows, prompts, internal paths, secrets, or implementation chatter.

Activity replaces the legacy product Memory domain. Search Activity to understand recent main-Agent work. Do not recreate a memory CLI, read the legacy table, or add a preference/vector-memory side channel.
