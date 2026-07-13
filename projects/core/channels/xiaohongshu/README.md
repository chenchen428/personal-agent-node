# xiaohongshu-channel

The first channel runtime for `personal-agent.local`. It wraps a pinned `xiaohongshu-mcp` binary behind Open Agent Bridge and never exposes the upstream API publicly.

- Listen address: `127.0.0.1:18060`
- Cookie path: `PRIVATE_SITE_DATA_ROOT/channels/xiaohongshu/cookies.json`
- Browser profile/cache: `PRIVATE_SITE_DATA_ROOT/channels/xiaohongshu/`
- Agent control surface: `https://agent.personal-agent.local/agent-channels`
- Compatibility redirect: `https://a.personal-agent.local/channels`
- Supported actions: QR login, same-browser scan/confirmation state detection, SMS verification-code submission, status, logout, search, and note detail
- Unsupported actions: publish, comment, reply, like, collect, follow, or account mutation

The adapter is built locally from the minimal compile-time file set at upstream PR #509 revision `0cf885c2d02745678ec6cc91b401d898373064e9`. A checksum-pinned workspace patch makes login-status polling inspect the browser that owns the QR code and exposes bounded intermediate states. The pristine source digest, patch digest, patched source digest, Go 1.24.6 toolchains, Go module checksums, and output platform are pinned; source files remain in the ignored runtime cache and are not shipped. The upstream repository does not declare a license at this revision, so the adapter remains an external private runtime rather than assimilated workspace source. CloakBrowser is MIT licensed.
