---
name: personal-runtime
description: Inspect and diagnose the local Personal Agent runtime through the stable personal-agent CLI. Use for runtime status, capability and command discovery, doctor checks, backup status, unavailable-command reporting, or choosing implemented versus preview command surfaces.
---

# Personal Runtime

Start with `personal-agent status --json`. Run only the smallest required read:

```text
personal-agent help --json
personal-agent help --preview --json
personal-agent help --all --json
personal-agent capabilities list --json
personal-agent capabilities inspect <capability> --json
personal-agent doctor --json
personal-agent backup status --json
```

Treat `implemented`, `preview`, and `planned` as different contracts. Opt into preview only when the user accepts it, preserve the returned warning, and never try to execute a planned command.

Use JSON output and report only redacted facts. Do not call internal HTTP ports, inspect product databases, use `private-site`, or recreate removed CLI aliases.

Read [command-map.md](references/command-map.md) for command discovery and [safety-and-confirmation.md](references/safety-and-confirmation.md) before any non-read-only operation.
