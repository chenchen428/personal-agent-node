---
name: personal-updates
description: Check, plan, apply, verify, and roll back Personal Agent client updates. Use for available-version checks, digest-bound update plans, restart handoff, persisted update jobs, previous-release rollback, failed-update recovery, or product-development-authorized client updates.
---

# Personal Updates

Use only the stable runtime CLI:

```text
personal-agent update check --json
personal-agent update status --json
personal-agent update plan --json
```

Checking and planning are R0. Applying executable code or rolling back is R3 and must use the exact operation ID and digest.

Outside registered product development, an Agent may execute an already locally approved plan but may not approve its own plan. In registered owner-initiated product development, pass the required `--product-development` flag so standing policy authorization applies only to the bound digest.

Expect the local connection to close during installation. Reconnect and report only the persisted `succeeded`, `rolled_back`, or `failed` state.

Read [updates.md](references/updates.md) for the full apply, restart, and rollback workflow.
