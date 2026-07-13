# Node Acceptance Standard

Use this standard for installed Node milestone, release and final decisions. Never report a milestone as final acceptance. Emit only sanitized JSON evidence tied to the exact commit, release ID and observation time.

## Node Core Gate

- The exact public commit passes Linux, macOS and Windows CI. The prerelease has an installable GitHub asset, checksums and SBOM.
- Install from the GitHub Release asset, never a source checkout or local build. Verify installed version, doctor, complete customer Harness and `CLAUDE.md`, `.agents/skills`, `.codex/skills`, `.claude/skills`, `.cursor/skills`.
- With Cloud disconnected, verify authenticated `/app`, conversation, BYOK, channels, managed platforms, files, automation, Pages and encrypted backup/restore.
- Verify desktop and mobile Console use, public/authenticated/local-admin/internal route classes and default denial for unknown routes. `local-admin` accepts authenticated loopback only.
- Verify registered stable capabilities through the versioned `personal-agent --json` contract, exit codes and redaction. Do not read internal databases or call internal ports.
- Verify R2/R3 plans expire in ten minutes, bind a digest and require explicit local human approval. Reject Agent self-approval, remote approval and changed or expired plans.
- Verify Worker and Extension failures are isolated and all mutable data stays under the configured data root.
- Verify fresh installation, upgrade and previous-release rollback.

## Optional Managed Cloud Integration

Managed Cloud is not a prerequisite for the Node core gate. For an integrated customer journey, additionally verify single-use authorization, recoverable pending enrollment, device enrollment, heartbeat, tenant assignment and managed data plane. Never record the authorization code, Node token or tunnel secret.

## Decision

Treat every missing required fact as failure. Source presence does not prove runtime behavior. Keep Node core and Cloud integration results separate so Cloud outages cannot invalidate the local-first product.
