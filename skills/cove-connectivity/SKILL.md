---
name: cove-connectivity
description: Configure and verify Cove connectivity modes and Cloud resource authorization. Use for local-only, Managed Cloud, self-hosted Edge, browser device authorization, public domain or Agent mail resource binding, tunnel readiness, or connectivity-mode troubleshooting.
---

# Cove Connectivity

Keep `local-only` fully functional. Never enroll Managed Cloud or switch connectivity modes without the user's explicit choice.

For Managed Cloud enrollment, use `personal-agent cloud connect --json`. For purpose-bound domain and Agent mail resources, use `personal-agent cloud login --json` and verify with `personal-agent cloud resources --json`. Never request or expose device codes, enrollment credentials, Node tokens, resource tokens, passwords, or GitHub credentials.

Treat connection-mode changes as R2. Use the returned plan/digest or browser authorization flow, wait for the verified result, and report only the public domain, Agent mail identity, and enabled/disabled service states.

Read [connectivity.md](references/connectivity.md) for local-only, Managed Cloud, self-hosted Edge, DNS, tunnel, and mail boundaries.

当前安装的自托管主空间域名已经验证且公网通道在线时，其他空间自动使用对应子域名，无需再次绑定或配置Relay。使用服务返回的继承状态和已验证地址；待验证或离线按实际原因处理，不让用户重复配置子空间。详细规则见 references/connectivity.md。
