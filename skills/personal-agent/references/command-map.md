# Command Map

The normative machine-readable command tree is `registry/commands.json`. Every command supports `--json`; Agents must not parse table or text output.

Each command leaf has exactly one implementation status:

| Status | Discovery | Execution |
| --- | --- | --- |
| `implemented` | Shown by `personal-agent help --json` | Available without an opt-in flag |
| `preview` | Shown by `personal-agent help --preview --json` | Requires `--preview`; every success includes a `PREVIEW_COMMAND` warning |
| `planned` | Shown only by `personal-agent help --all --json` | Always fails closed with `CAPABILITY_UNAVAILABLE` |

`--all` changes help visibility only. It cannot enable a command. Unknown command leaves also fail closed with `CAPABILITY_UNAVAILABLE`.

The current implemented surface is `help`, `status`, `doctor`, `capabilities list|inspect`, `skill list|inspect|verify`, `connection status`, `cloud connect|login|resources|status`, `backup status`, and `mail status`. The current preview surface is `mail plan`, `extension list|inspect`, and `operation list|show|approve`. Read the Registry or `help --all --json` for the planned roadmap; do not treat roadmap entries as installed capabilities.

`personal-agent mail status --json` is an R0, secret-redacted readiness check. It never creates the mail ingress token and bounds archive accounting; `doctor` skips archive accounting entirely. `personal-agent mail plan --preview --json` is non-mutating and describes the user-managed local MTA pipe. It never installs Postfix, opens port 25, embeds an SMTP server, or creates managed raw SMTP/IMAPS transport. Use `workflows/local-mail.md` for the reviewed boundary and non-secret example.

`personal-agent cloud connect --json [--cloud-url <https-url>] [--no-open]` performs browser device authorization. During the wait it emits a `cloud.device-authorization` progress envelope containing only `userCode`, `verificationUrl`, `verificationUrlComplete`, expiry and polling interval; its final stdout remains the standard command envelope. Never request an email, authorization code, slug, device code, enrollment credential, or Node token on the command line.

Run `personal-agent cloud connect --help --json` for the machine-readable usage, options, R2 classification, browser-authorization method, required human action, and forbidden secret inputs. This help call is read-only and does not begin authorization.

`personal-agent cloud login --json [--cloud-url <https-url>] [--no-open]` performs the separate browser resource authorization. Its progress output contains only the user code and same-origin verification URLs; the private device code and returned 24-hour resource token never appear in output. The token is stored only under local mode-600 secrets. `personal-agent cloud resources --json` refreshes and reports only the public domain, Agent mail identity and managed-service readiness. The command accepts no GitHub user ID or password.

Use `result.commands` from the appropriate help view for executable commands. `result.commandGroups.planned` is roadmap metadata only. Never fall back to an internal HTTP endpoint, database, `private-site`, or `open-abg` when the public CLI reports `CAPABILITY_UNAVAILABLE`.
