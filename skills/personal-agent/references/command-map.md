# Command Map

The normative machine-readable command tree is `registry/commands.json`. Every command supports `--json`; Agents must not parse table or text output.

Each command leaf has exactly one implementation status:

| Status | Discovery | Execution |
| --- | --- | --- |
| `implemented` | Shown by `personal-agent help --json` | Available without an opt-in flag |
| `preview` | Shown by `personal-agent help --preview --json` | Requires `--preview`; every success includes a `PREVIEW_COMMAND` warning |
| `planned` | Shown only by `personal-agent help --all --json` | Always fails closed with `CAPABILITY_UNAVAILABLE` |

`--all` changes help visibility only. It cannot enable a command. Unknown command leaves also fail closed with `CAPABILITY_UNAVAILABLE`.

The current implemented surface is `help`, `status`, `doctor`, `capabilities list|inspect`, `skill list|inspect|verify`, `connection status`, `cloud connect|status`, and `backup status`. The current preview surface is `extension list|inspect` and `operation list|show|approve`. Read the Registry or `help --all --json` for the planned roadmap; do not treat roadmap entries as installed capabilities.

`personal-agent cloud connect --json [--cloud-url <https-url>] [--no-open]` performs browser device authorization. During the wait it emits a `cloud.device-authorization` progress envelope containing only `userCode`, `verificationUrl`, `verificationUrlComplete`, expiry and polling interval; its final stdout remains the standard command envelope. Never request an email, authorization code, slug, device code, enrollment credential, or Node token on the command line.

Use `result.commands` from the appropriate help view for executable commands. `result.commandGroups.planned` is roadmap metadata only. Never fall back to an internal HTTP endpoint, database, `private-site`, or `open-abg` when the public CLI reports `CAPABILITY_UNAVAILABLE`.
