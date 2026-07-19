# Command Map

The normative machine-readable command tree is `registry/commands.json`. Every command supports `--json`; Agents must not parse table or text output.

Each command leaf has exactly one implementation status:

| Status | Discovery | Execution |
| --- | --- | --- |
| `implemented` | Shown by `personal-agent help --json` | Available without an opt-in flag |
| `preview` | Shown by `personal-agent help --preview --json` | Requires `--preview`; every success includes a `PREVIEW_COMMAND` warning |
| `planned` | Shown only by `personal-agent help --all --json` | Always fails closed with `CAPABILITY_UNAVAILABLE` |

`--all` changes help visibility only. It cannot enable a command. Unknown command leaves also fail closed with `CAPABILITY_UNAVAILABLE`.

The current implemented surface is `help`, `status`, `doctor`, `capabilities list|inspect`, `skill list|inspect|verify`, `activity list|search|show|create|upsert|update|hide|restore`, `connection status`, `pa-cli session list|search|start|status|input|resume|update`, `pa-cli cron list|create|update|delete|run`, `pa-cli connection list|inspect|<id> status|connect`, `pa-cli pages upload|publish`, `cloud connect|login|resources|status`, `backup status`, `mail status`, `app list|inspect|verify|set-default|clear-default`, and `update check|status|plan|apply|rollback`. Generic user-defined event/rule automation commands are removed; governed scheduled tasks are not part of that removed surface. The current preview surface is `mail plan`, `extension list|inspect`, and `operation list|show|approve`.

Child task creation uses `pa-cli session start --parent <main-session> --title "<20字内标题>" --description "<100字内描述>" (--task "<execution prompt>"|--task-file <utf8-file>) --json`. All three semantic fields are required for a child task. The execution prompt preserves the latest visible parent request and every material delegated requirement; positional fragments after `--task` are joined instead of discarded. The result keeps the canonical desktop path in `internalUrl`, returns a complete Managed Mobile HTTPS address in `url`, or leaves `url` empty and explains the unavailable online link in `linkNotice`. Never concatenate a domain with `internalUrl`. Update only the user-facing metadata with `pa-cli session update --session <task-id> [--title "..."] [--description "..."] --json`; then verify with `pa-cli session status --session <task-id> --json`. See [tasks.md](tasks.md).

`pa-cli pages publish --json` keeps the stored Page route in `internalUrl` and returns the remotely deliverable managed-tunnel HTTPS address in `url`. If no accessible domain is configured, `url` is empty and `linkNotice` explains that the Page cannot be opened directly. Never replace either value with a drive path, `file://`, localhost, or a loopback URL. See [online-pages.md](online-pages.md).

Activity commands require the ephemeral capability issued only to the current verified main-Agent turn. `activity list|search|show` are R0 and `create|upsert|update|hide|restore` are reversible R1 writes. The capability expires at turn end, cannot be delegated to workers, and must never appear in output or persisted content. See [activity.md](activity.md).

`personal-agent mail status --json` is an R0, secret-redacted readiness check. It never creates the mail ingress token and bounds archive accounting; `doctor` skips archive accounting entirely. `personal-agent mail plan --preview --json` is non-mutating and describes the user-managed local MTA pipe. It never installs Postfix, opens port 25, embeds an SMTP server, or creates managed raw SMTP/IMAPS transport. Use `workflows/local-mail.md` for the reviewed boundary and non-secret example.

`personal-agent cloud connect --json [--cloud-url <https-url>] [--no-open]` performs browser device authorization. During the wait it emits a `cloud.device-authorization` progress envelope containing only `userCode`, `verificationUrl`, `verificationUrlComplete`, expiry and polling interval; its final stdout remains the standard command envelope. Never request an email, authorization code, slug, device code, enrollment credential, or Node token on the command line.

Run `personal-agent cloud connect --help --json` for the machine-readable usage, options, R2 classification, browser-authorization method, required human action, and forbidden secret inputs. This help call is read-only and does not begin authorization.

`personal-agent cloud login --json [--cloud-url <https-url>] [--no-open]` performs the separate browser resource authorization. Its progress output contains only the user code and same-origin verification URLs; the private device code and returned 24-hour resource token never appear in output. The token is stored only under local mode-600 secrets. `personal-agent cloud resources --json` refreshes and reports only the public domain, Agent mail identity and managed-service readiness. The command accepts no GitHub user ID or password.

Use `result.commands` from the appropriate help view for executable commands. `result.commandGroups.planned` is roadmap metadata only. Never fall back to an internal HTTP endpoint, database, `private-site`, or a removed CLI alias when the public CLI reports `CAPABILITY_UNAVAILABLE`.

Update discovery, status, and planning are R0. Applying or restoring executable code is R3 and requires the exact approved operation ID and digest. See [updates.md](updates.md); a non-interactive Agent may execute an already approved plan but may never create its own approval.
