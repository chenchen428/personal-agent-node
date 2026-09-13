---
name: cove-runtime
description: Inspect and diagnose the local Cove runtime and apply the generic governed Pages contract. Use for runtime status, capability and command discovery, doctor checks, backup status, unavailable-command reporting, choosing implemented versus preview command surfaces, or authoring and publishing a Cove Page with mobile-friendly content.
---

# Cove Runtime

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

Read [command-map.md](references/command-map.md) for command discovery and [safety-and-confirmation.md](references/safety-and-confirmation.md) before any non-read-only operation. Before authoring or publishing any Page, read and satisfy the mobile authoring and publishing requirements in [page-publishing.md](references/page-publishing.md).

发布页或二维码失败时，读取 `pages poster --json` 的安全错误码和恢复建议，按 page-publishing.md 先诊断并完成原授权范围内的可行修复。先交付已核实的可用结果，不重复盲试、不把资源或入口异常说成页面不存在。
