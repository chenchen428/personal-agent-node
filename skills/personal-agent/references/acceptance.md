# Node Acceptance Standard

Use this standard for installed Node milestone, release and final decisions. Never report a milestone as final acceptance. Emit only sanitized JSON evidence tied to the exact commit, release ID and observation time.

## Node Core Gate

- The exact public commit passes Linux, macOS and Windows CI. The prerelease has Windows x64, macOS x64/ARM64 and Linux x64/ARM64 assets, checksums, SBOM, native signatures, notarization where applicable, Sigstore bundles and provenance.
- Install from the self-contained GitHub Release platform asset, never a source checkout or local build. Prove the customer machine needs neither host Node.js nor a development Agent. Verify the installed version, exact bundled Node runtime, native setup/launcher, doctor, canonical customer Harness, `AGENTS.md`, registries, Skills and `.codex/skills`. `CLAUDE.md`, `.agents`, `.claude` and `.cursor` are repository-development compatibility only and must not gate the installed product.
- Fresh installation must start the per-user service and use a single-use, short-lived loopback nonce to open authenticated `/app/setup` without printing the nonce. The user establishes durable local access backed by a salted verifier. Setup Center, `personal-agent setup status` and doctor share one versioned contract and independently report console, Agent, remote and mail readiness.
- With Cloud disconnected, verify authenticated `/app`, local Web conversation, BYOK, channels, managed platforms, files, automation, Pages and encrypted backup/restore. For release and final acceptance, install the public GitHub Release asset, authenticate to its local `/app/chat`, send a unique prompt to the real Agent runtime and observe the Agent reply in that same session. Use exactly this sanitized object and never record the prompt, reply or session identifier:

```json
{
  "releaseAssetRuntime": true,
  "route": "/app/chat",
  "authenticated": true,
  "uniquePrompt": true,
  "realAgentRuntime": true,
  "sameSessionAgentReply": true,
  "wechatRequired": false
}
```

An artifact surface smoke, deterministic runner or source test cannot set `realAgentRuntime` or `sameSessionAgentReply` to true. WeChat is optional and never blocks the Node core gate.
- Verify desktop and mobile Console use, public/authenticated/local-admin/internal route classes and default denial for unknown routes. `local-admin` accepts authenticated loopback only.
- Verify registered stable capabilities through the versioned `personal-agent --json` contract, exit codes and redaction. Do not read internal databases or call internal ports.
- Verify R2/R3 plans expire in ten minutes, bind a digest and require explicit local human approval. Reject Agent self-approval, remote approval and changed or expired plans.
- Verify Worker and Extension failures are isolated and all mutable data stays under the configured data root.
- Verify fresh installation, restart, upgrade, failed-candidate automatic pointer/service restoration and native previous-release rollback. Stable Go launchers must follow the active immutable release and remain usable when Node cannot start. Legacy mail migration must be idempotent, fail closed on conflicts and retain its source for rollback.
- For release and final acceptance, verify a user-managed local MTA, absence of a bundled SMTP server, an installed current-following `open-abg-mail-ingest` shim, real EML plus attachment ingestion into local-only storage, authenticated `/app/mail`, ordinary encrypted backup/restore of `mail/`, absence of managed raw SMTP and IMAPS tunnels, read-only `mail status`, and preview-only `mail plan`. Evidence must omit real recipients, message bodies, attachments and secrets.

## Optional Managed Cloud Integration

Managed Cloud is not a prerequisite for the Node core gate. For an integrated customer journey, additionally verify browser device authorization, same-origin verification URLs, bounded polling/slow-down, expiry and denial, single-use enrollment credentials, recoverable pending enrollment, device enrollment, heartbeat, tenant assignment and managed data plane. Verify CLI/browser output never contains a device code, enrollment credential, Node token, generated local password or tunnel secret.

Also verify GitHub Owner login exposes no Cloud password setup surface; Setup Center starts purpose-bound browser authorization without exposing the private device code or one-time token; and local state contains only the short-lived resource token plus redacted resources. Managed mail and managed configuration remain disabled until a public domain and matching Agent mailbox are both detected, while actual mail readiness still requires real delivery and recovery. Setup Center displays each independent prerequisite. WeChat is an optional post-core channel; its coordinator never intercepts ordinary conversation as credentials.

## Decision

Treat every missing required fact as failure. Source presence does not prove runtime behavior. Keep Node core and Cloud integration results separate so Cloud outages cannot invalidate the local-first product.
