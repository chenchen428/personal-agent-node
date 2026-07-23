---
name: personal-tasks
description: Create, inspect, update, resume, and report Personal Agent child tasks through pa-cli sessions. Use for delegating real multi-step work, checking task progress, updating task metadata, resuming an exact paused task, preserving a full execution prompt, or consuming verified Work artifact information.
---

# Personal Tasks

Use a child task for real multi-step work involving files, commands, research plus delivery, Pages, deployment, cross-module changes, multiple deliverables, or continued execution. Do not create a task for a greeting, clarification, simple answer, quick atomic action, schedule management, existing-result lookup, or task-status question.

Search current children first. Resume only an exact paused match:

```text
pa-cli session list --parent <main-session-id> --all --json
pa-cli session status --session <task-id> --json
pa-cli session resume --session <task-id> --task "继续完成原任务；先检查已有进展和暂停原因，再从未完成处继续。"
```

Never resume a task merely to answer a status question. Keep titles at most 20 visible characters and descriptions at most 100. Preserve the full execution contract separately.

Read [tasks.md](references/tasks.md) for creation, metadata updates, links, status reporting, resume safety, and Work artifact envelopes.
