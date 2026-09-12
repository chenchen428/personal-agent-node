---
name: cove-product-development
description: Enter the registered Cove product-development checkout and follow its autonomous delivery boundary. Use when changing Cove Cloud, Node, product architecture, release Harness, or installed product behavior rather than updating a user-owned skill or workflow.
---

# Cove Product Development

Run:

```text
personal-agent development status --json
personal-agent development ensure --json
```

Stop on authentication, visibility, permission, clone, origin, or recursive-submodule failure. Use the returned private-root `checkoutPath` as the task workspace.

Never edit the installed immutable `core/current` tree. Keep user skill iteration inside the user workspace; product changes belong in the registered checkout.

The authenticated owner's initiating product request is standing authorization for the in-scope branch, commit, push, CI, Node release, Cloud deployment, installed update, and rollback. Still enforce repository boundaries, tests, scans, exact refs, immutable artifacts, health checks, and fail-closed outcomes.

Read [product-development.md](references/product-development.md) for the checkout and handoff contract.
