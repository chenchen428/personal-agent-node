# Core Channels

Channels are reusable integrations owned by the Site Node. They live here even when their implementation wraps a third-party project.

- `xiaohongshu/` contains the pinned Xiaohongshu adapter source contract and patches.
- `egress/` contains the optional loopback-only channel egress runtime contract.

Channel cookies, QR sessions, browser profiles, caches, and logs belong under
`PRIVATE_SITE_DATA_ROOT/channels` or `PRIVATE_SITE_DATA_ROOT/runtime`; they are
never committed or packaged as shared data. Platform-built adapter executables
are product runtime and live inside the immutable Core release.
