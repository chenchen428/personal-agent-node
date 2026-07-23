---
name: personal-schedules
description: Create, update, list, run, and delete Personal Agent scheduled tasks through pa-cli cron. Use for reminders, recurring work, the task module's Automation view, cron expressions, timezones, enabled state, next-run verification, or manual scheduled-task execution.
---

# Personal Schedules

Manage schedules directly in the main Agent turn. Do not create a child task merely to create or edit a schedule.

Use `pa-cli cron ... --json`. Convert ordinary reminder language to a five-field cron expression, preserve the IANA timezone, and include the exact reminder or work content in the prompt. The scheduler rejects intervals shorter than fifteen minutes.

Creating or updating a private schedule is R1. Delete only on an explicit request naming the schedule. Run now only when explicitly requested because it may execute work and notifications immediately.

After every mutation, list persisted schedules and verify the ID, enabled state, cron expression, timezone, prompt, and next run.

Read [scheduled-tasks.md](references/scheduled-tasks.md) for the full command and verification contract.
