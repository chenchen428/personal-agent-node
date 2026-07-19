# Scheduled Tasks

Scheduled tasks are an implemented, local-first Personal Agent capability. They are distinct from the removed generic event/rule automation product.

Use the stable `pa-cli cron` commands and always request JSON output:

```text
pa-cli cron list --json
pa-cli cron create --name <name> --cron "0 21 * * *" --timezone Asia/Shanghai --prompt <task> --json
pa-cli cron update --id <task-id> [--name <name>] [--cron <expression>] [--timezone <iana-zone>] [--prompt <task>] [--enabled|--disabled] --json
pa-cli cron delete --id <task-id> --json
pa-cli cron run --id <task-id> --json
```

Creating or updating a private local schedule is an auditable R1 write. Deletion is destructive and requires an explicit user request naming the schedule. Manual execution may cause the scheduled work and configured notification to run immediately, so use it only when the user explicitly asks to run or test the task now.

Convert ordinary reminder language into a five-field cron expression and preserve the user's stated IANA timezone. If the user gives a local clock time without a timezone, use the current Personal Agent timezone and state it in the confirmation. The scheduler rejects expressions that may run more often than once every fifteen minutes.

The prompt must describe the work to perform when the schedule fires. For a reminder, include the exact reminder content rather than only a generic instruction such as “send a reminder.” Scheduled execution creates a normal task, so the task list remains the source of execution details.

After every create, update, or delete, run `pa-cli cron list --json` and verify the returned task ID, enabled state, cron expression, timezone, prompt, and next run. Report success only from that persisted result. If creation fails, report the actual CLI error; do not describe the capability as removed when `personal-agent capabilities inspect schedules --json` reports `implemented`.
