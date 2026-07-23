---
name: personal-connectivity
description: Configure and verify Personal Agent connectivity modes and Cloud resource authorization. Use for local-only, Managed Cloud, self-hosted Edge, browser device authorization, public domain or Agent mail resource binding, tunnel readiness, or connectivity-mode troubleshooting.
---

# Personal Connectivity

Keep `local-only` fully functional. Never enroll Managed Cloud or switch connectivity modes without the user's explicit choice.

For Managed Cloud enrollment, use `personal-agent cloud connect --json`. For purpose-bound domain and Agent mail resources, use `personal-agent cloud login --json` and verify with `personal-agent cloud resources --json`. Never request or expose device codes, enrollment credentials, Node tokens, resource tokens, passwords, or GitHub credentials.

Treat connection-mode changes as R2. Use the returned plan/digest or browser authorization flow, wait for the verified result, and report only the public domain, Agent mail identity, and enabled/disabled service states.

Read [connectivity.md](references/connectivity.md) for local-only, Managed Cloud, self-hosted Edge, DNS, tunnel, and mail boundaries.
