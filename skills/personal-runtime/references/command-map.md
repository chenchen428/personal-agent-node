# Runtime Command Map

Treat `registry/commands.json` as the machine-readable source. Every stable runtime command supports JSON output.

| Status | Discovery | Execution |
| --- | --- | --- |
| `implemented` | `personal-agent help --json` | Execute without an opt-in flag. |
| `preview` | `personal-agent help --preview --json` | Require `--preview` and preserve `PREVIEW_COMMAND`. |
| `planned` | `personal-agent help --all --json` | Never execute; fail closed with `CAPABILITY_UNAVAILABLE`. |

`--all` changes discovery only. Unknown leaves and planned commands remain unavailable.

The runtime Skill owns `help`, `status`, `doctor`, `capabilities list|inspect`, `skill list|inspect|verify`, and `backup status`. Route other implemented groups to their focused Skill:

- Activity: `$personal-activity`
- Cloud connectivity: `$personal-connectivity`
- Connections and mail: `$personal-connections`
- Tasks: `$personal-tasks`
- Schedules: `$personal-schedules`
- Pages: use `pa-cli pages` through the [generic Page publishing contract](page-publishing.md); no separate Page Skill or template selection exists.
- Files: `$personal-files`
- Data: `$personal-data`
- Updates: `$personal-updates`
- Product development: `$personal-product-development`

Use only `result.commands` from the appropriate help view. Never fall back to an internal HTTP endpoint, database, `private-site`, or removed CLI alias.
