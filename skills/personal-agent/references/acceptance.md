# Node Acceptance Standard

Use this standard for installed Node milestone, release and final decisions. Never report a milestone as final acceptance. Emit only sanitized JSON evidence tied to the exact commit, release ID and observation time.

## Node Core Gate

- The exact public commit passes Linux, macOS and Windows CI. The prerelease has an installable GitHub asset, checksums and SBOM.
- Install from the GitHub Release asset, never a source checkout or local build. Verify installed version, doctor, complete customer Harness and `CLAUDE.md`, `.agents/skills`, `.codex/skills`, `.claude/skills`, `.cursor/skills`.
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
- Verify fresh installation, upgrade and previous-release rollback. The GitHub Release installer must explicitly run packaged preparation so fresh and upgraded Nodes receive missing local secrets and current-following shims. Legacy mail migration must be idempotent, fail closed on conflicts and retain its source for rollback.
- For release and final acceptance, verify a user-managed local MTA, absence of a bundled SMTP server, an installed current-following `open-abg-mail-ingest` shim, real EML plus attachment ingestion into local-only storage, authenticated `/app/mail`, ordinary encrypted backup/restore of `mail/`, absence of managed raw SMTP and IMAPS tunnels, read-only `mail status`, and preview-only `mail plan`. Evidence must omit real recipients, message bodies, attachments and secrets.

## Optional Managed Cloud Integration

Managed Cloud is not a prerequisite for the Node core gate. For an integrated customer journey, additionally verify browser device authorization, same-origin verification URLs, bounded polling/slow-down, expiry and denial, single-use enrollment credentials, recoverable pending enrollment, device enrollment, heartbeat, tenant assignment and managed data plane. Verify CLI/browser output never contains a device code, enrollment credential, Node token, generated local password or tunnel secret.

Also verify GitHub Owner login exposes no password setup surface; `personal-agent cloud login` uses a separate, purpose-bound browser authorization; the private device code and one-time token issuance remain absent from public output; and local state contains only the short-lived resource token plus redacted resources. Managed mail and managed configuration must remain disabled until a public domain and matching Agent mailbox are both detected. The Console displays each prerequisite and resulting state. WeChat binding sends one proactive state summary, while its Cloud binding coordinator sends a same-origin browser link and never intercepts ordinary conversation as credentials.

## Decision

Treat every missing required fact as failure. Source presence does not prove runtime behavior. Keep Node core and Cloud integration results separate so Cloud outages cannot invalidate the local-first product.
