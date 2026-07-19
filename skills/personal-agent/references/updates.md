# Client updates

Use only the stable runtime CLI:

```text
personal-agent update check --json
personal-agent update status --json
personal-agent update plan --json
personal-agent update apply --operation <id> --digest <digest> --json
personal-agent update rollback --json
```

`check`, `status`, and `plan` are R0. A plan records the exact release, artifact digest, current release, restart impact and rollback target. `apply` is R3. For an ordinary user-initiated update it may still use the local Console flow. During registered Personal Agent product development, the initiating authenticated Owner request is standing authorization: the runtime policy authorizes the matching update plan automatically and no local confirmation is required.

When the user asks the main Agent to update:

1. Run `update check` and report the current/available versions.
2. Run `update plan` and retain its operation ID and digest.
3. Run `update apply --product-development` with the exact job, operation ID and digest. The flag is valid only for the registered product-development flow and authorizes this exact plan automatically; do not ask the user to visit the desktop “软件更新” page. Do not substitute a URL, path, version or digest.
4. Expect the local Agent connection to close while the desktop client installs and automatically restarts.
5. Reconnect and run `update status`. Report `succeeded`, `rolled_back`, or `failed` from the persisted job; do not infer success from the old process exiting.

`update rollback` without an operation creates a new R3 rollback plan for the locally retained `previous` release. Execute it with the returned operation and digest plus `--product-development`; registered product development authorizes the bound plan automatically. Rollback never downloads an artifact and never deletes Workspace data.
