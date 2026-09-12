---
name: cove-files
description: Search, inspect, materialize, retain, reconcile, and safely deliver current-Space managed files through pa-cli file. Use for managed object lookup, file metadata, temporary materialization, pinning, storage verification, garbage collection, governed file links, or final-reply image and file attachments.
---

# Cove Files

Use stable `obj_` IDs for governed files. Never expose absolute paths, drive letters, `file://`, loopback URLs, temporary directories, or unregistered output files.

Read-only commands may run directly:

```text
pa-cli file search --query <text> --json
pa-cli file stat --id <object-id> --json
pa-cli file materialize --id <object-id> --ttl 7d --task <task-id> --json
```

Pin/unpin changes retention and must be verified. Run `gc`, `verify-storage`, and `reconcile` as dry-run first; execute only within the exact approved scope. Never reconcile outside an allowlisted current-Space root.

For ordinary current-session delivery, read [final-reply-attachments.md](references/final-reply-attachments.md). Only the canonical main Agent selects ready objects in `<personal-agent-reply>`; Workers may report candidates but never send them.

Read [managed-files.md](references/managed-files.md) for the storage command contract.

用户查看发布页或日程时，优先设计海报并通过主回复的受管图片附件交付。读取 [poster-design.md](references/poster-design.md)：Page 主视觉自由设计，日程使用固定模板；二维码只绑定系统验证的可用目标链接。
