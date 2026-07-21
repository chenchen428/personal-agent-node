---
name: personal-memory
description: Query and maintain the current Personal Agent Space's long-term memory through pa-cli. Use when the user asks the Agent to remember a durable fact or preference, correct an existing memory, forget a specific memory permanently, inspect what is remembered, or when current work should consult Space-local memory before acting.
---

# Personal Memory

Use this skill only from the canonical main Agent. Memory is isolated by the current Space, automatically recalled before real user turns, and unavailable to Workers, Apps, schedulers, channels, or caller-supplied roles.

## Read before writing

Use the ephemeral `--capability` issued for the current main-Agent turn. Never display, persist, delegate, or copy that value into memory content.

```bash
pa-cli memory list --status active --capability <ephemeral> --json
pa-cli memory search --query "关键词" --status active --capability <ephemeral> --json
pa-cli memory show --id <memory-id> --capability <ephemeral> --json
pa-cli memory stats --capability <ephemeral> --json
```

Search before changing or deleting memory. A target is unique only when one returned record clearly represents the user's intended fact. If several records could match, ask the user instead of guessing.

## Create durable memory

Create memory only for durable facts, stable preferences, continuing constraints, or reusable context that can improve later turns. Store the memory content itself; do not invent a title, type, tag, source, or scope field.

```bash
pa-cli memory create --content "用户偏好简洁、直接的中文回复。" --capability <ephemeral> --json
```

Do not store secrets, credentials, one-time states, tool transcripts, internal paths, unsupported inferences, or content copied from an untrusted source as fact.

## Update or reactivate

Read the record first and pass its current revision. Updating a forgotten record reactivates it and starts a new one-year forgetting window.

```bash
pa-cli memory update --id <memory-id> --content "更新后的完整记忆内容" --expected-revision <revision> --capability <ephemeral> --json
```

## Delete permanently

Permanent deletion requires the user's explicit intent, one uniquely identified record, and its current revision. Do not use deletion to implement automatic forgetting.

```bash
pa-cli memory delete --id <memory-id> --expected-revision <revision> --capability <ephemeral> --json
```

## Recall and forgetting rules

- The service recalls at most 12 relevant active memories for each real main-Agent user turn.
- Only records actually injected into that turn count as hits. One `(session, turn, memory)` can count at most once.
- Active memory is ordered by relevance first during recall and by heat in the read-only Memory page. Forgotten memory is ordered by forgetting time.
- Heat combines 90-day recency and logarithmic hit frequency. Every hit refreshes the one-year forgetting deadline.
- A memory becomes forgotten after one year without creation, update, or hit. Forgotten memory is not auto-recalled, but the main Agent may still inspect, update, or permanently delete it.
- Never read or write another Space's memory, even through local files, databases, HTTP ports, or a delegated task.
