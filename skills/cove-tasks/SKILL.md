---
name: cove-tasks
description: Create, inspect, update, resume, and report Cove child tasks through pa-cli sessions. Use for delegating real multi-step work, checking task progress, updating task metadata, resuming an exact paused task, preserving a full execution prompt, or consuming verified Work artifact information.
---

# Cove Tasks

日程入口提供日程和执行记录两个视图；计划是其共享的数据模型，在日程详情中查看。指定时间、周期安排或提醒由 cove-schedules 使用统一 plan 创建；每次执行仍是普通子任务。此技能处理立即委托和具体执行会话，不为同一事项重复建立时间计划。任务的 planId 与 occurrenceAt 只用于回到原计划，不意味着可以修改整个周期。未知结果的中断执行先查证再按用户意图恢复。

Use a child task for real multi-step work involving files, commands, research plus delivery, Pages, deployment, cross-module changes, multiple deliverables, or continued execution. Do not create a task for a greeting, clarification, simple answer, quick atomic action, schedule management, existing-result lookup, or task-status question.

Search current children first. Create generic work with pa-cli session start --parent <main-session-id> --title "<title>" --description "<description>" --task-file <utf8-task-file> --json. Resume only an exact paused match:

```text
pa-cli session list --parent <main-session-id> --all --json
pa-cli session status --session <task-id> --json
pa-cli session resume --session <task-id> --task "继续完成原任务；先检查已有进展和暂停原因，再从未完成处继续。"
```

Never resume a task merely to answer a status question. Keep titles at most 20 visible characters and descriptions at most 100. Preserve the full execution contract separately.

只要涉及子任务，必须给用户进度查看页面。创建或恢复后，在第一次确认“已开始处理”的回复中就附上工具返回的任务进度 url，例如“已开始整理，查看进度（使用服务返回的url作为链接）”；不能只说已经安排，也不能等用户追问。后续进度回复和纯状态查询也保留该入口，多个主要任务分别给出对应入口。使用系统已有执行详情页，无需另外生成 Page。url 不可用时准确说明 linkNotice，本机用户可从“日程 → 执行记录”查看；不拼域名或伪造公网链接。主空间域名继承可用时使用服务返回的子空间地址，不要求用户重复配置。

Read [tasks.md](references/tasks.md) for creation, metadata updates, links, status reporting, resume safety, and Work artifact envelopes.
