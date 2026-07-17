# Client updates

Use only the stable runtime CLI:

```text
personal-agent update check --json
personal-agent update status --json
personal-agent update plan --json
personal-agent update apply --operation <id> --digest <digest> --json
personal-agent update rollback --json
```

`check`, `status`, and `plan` are R0. A plan records the exact release, artifact digest, current release, restart impact and rollback target. `apply` is R3 and succeeds only when the matching plan was approved by an authenticated human in the local desktop Console or an interactive local TTY. Never approve from a conversation, Worker, remote browser, Personal App, or Extension.

When the user asks the main Agent to update:

1. Run `update check` and report the current/available versions.
2. Run `update plan`, retain its operation ID and digest, and ask the user to confirm in the desktop “软件更新” page.
3. The desktop confirmation approves and starts that exact plan. If approval was completed separately in an interactive TTY, run `update apply` with the exact ID and digest. Do not substitute a URL, path, version, or digest.
4. Expect the local Agent connection to close while the desktop client installs and automatically restarts.
5. Reconnect and run `update status`. Report `succeeded`, `rolled_back`, or `failed` from the persisted job; do not infer success from the old process exiting.

`update rollback` without an operation creates a new R3 rollback plan for the locally retained `previous` release. It also requires local approval; execute it with the returned operation and digest. Rollback never downloads an artifact and never deletes Workspace data.
