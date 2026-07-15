# ADR 0002: Self-contained installation and local Setup Center

Managed Cloud tunnel implementation details in this ADR are superseded by [ADR 0004](0004-managed-cloud-reverse-tunnel.md).

- Status: Accepted
- Date: 2026-07-15
- Scope: Public Personal Agent Node repository
- Replaces after acceptance: the Agent-prompt-first and WeChat-first parts of the
  Phase 0 release-installation baseline

## Summary

Personal Agent Node will be installed by a deterministic, self-contained product
installer. A developer Agent is not part of the normal installation path.

The product remains a Node.js application. A small Go executable will own native
installation, release verification, current/previous activation, system-service
registration, process launch, initial browser handoff, and rollback. The local
Node Console will own user-facing setup, detection, guidance, and governed repair.

Codex remains the only supported Agent runtime for the installed product. Other
Agent bridge layouts remain repository-development compatibility surfaces and are
not prerequisites for a customer installation.

## Context

The current public installation path asks the user to install Node.js 22, choose
a GitHub Release asset, run a JavaScript installer, update `PATH`, invoke several
CLI commands, and use a long natural-language prompt when a local development
Agent performs those steps. The installer prepares an immutable release, but
initialization, local authentication, system-service activation, browser opening,
Codex readiness, managed connectivity, and actual mail readiness are not presented
as one user-owned flow.

The local Console currently displays some managed-domain and mail prerequisites,
but it does not provide a complete setup state machine or guided remediation.
`personal-agent doctor` is read-only, as required, but its current checks do not
prove that the supervisor, authenticated Console, Codex app-server, real Web
conversation, public route, or mail delivery path works.

The Phase 0 baseline also says that a fresh installation immediately prompts for
WeChat binding, while final conversation acceptance explicitly records
`wechatRequired=false`. This makes an optional channel look like a core product
prerequisite.

## Decision drivers

The selected design must:

1. Let an ordinary user install and recover the product without a development
   Agent, source checkout, preinstalled Node.js, or manual JSON interpretation.
2. Preserve the existing Node.js runtime and avoid a product rewrite.
3. Support Windows, macOS, and Linux with one small native codebase.
4. Preserve immutable releases, exact-version verification, `current`/`previous`
   rollback, and customer data outside release directories.
5. Keep local-only installation and authenticated `/app` functional without
   Personal Agent Cloud.
6. Treat Codex, public connectivity, Agent mail identity, actual mail delivery,
   and WeChat as separate facts.
7. Reuse one setup contract across Installer, Console, CLI, tests, and acceptance.
8. Keep all mutations behind the existing R0-R3 policy and local approval model.

## Decision

### 1. Split native lifecycle from product behavior

The installed system has two implementation layers:

```text
platform package
  |
  +-- personal-agent-setup       Go; install, verify, activate, service, rollback, uninstall
  +-- personal-agent             Go; stable launcher into the active Node release
  +-- bundled Node.js runtime    exact supported runtime, not a host prerequisite
  +-- immutable Node payload     existing JS application, Console, Skills, assets

local browser
  |
  +-- /app/setup                 Node.js Setup Center
  +-- /app                       Node.js product Console
```

Go does not reimplement product rules, Cloud authorization, channels, mail,
conversation, Skills, or data access. Those remain in Node domain services. The
native executable only owns operations that must work before Node is installed or
when the active Node release cannot start.

This does not introduce a third product boundary. The Go source and binaries are
internal modules of Personal Agent Node and ship in the same Node release.

### 2. Use a full platform package as the primary artifact

Each supported operating-system and architecture combination receives a complete
GitHub Release asset:

| Platform | Primary asset | Initial architectures |
| --- | --- | --- |
| Windows | installer `.exe` | x86-64 |
| macOS | installer `.pkg` | Apple Silicon, x86-64 |
| Linux | `.tar.zst`, followed by `.deb` | x86-64, ARM64 |

The package contains the Go setup executable, Go launcher, exact supported Node.js
runtime, immutable application payload, public manifest, checksums, signatures or
explicit prerelease signing status, licenses, and SBOM. A small online bootstrapper
may be offered later, but it is not the only supported recovery artifact.

The installer must not use the system `node`, `npm`, `tar`, `curl`, PowerShell,
or shell as a required execution dependency. Platform packaging and code signing
run on native CI runners; no release claim is inferred from cross-compilation
alone.

### 3. Preserve immutable release layout

The target user-scope layout is:

```text
<install-root>/
  bin/
    personal-agent[.exe]
    personal-agent-setup[.exe]
  releases/
    <release-id>/
      runtime/node[.exe]
      app/
      release-manifest.json
      SBOM.spdx.json
  current -> releases/<release-id>
  previous -> releases/<previous-id>
  installation.json

<data-root>/
  config/
  secrets/
  runtime/
  logs/
  databases/
  mail/
  backups/
  workspace/
```

Windows may implement `current` and `previous` as verified directory junctions.
The stable Go launcher resolves `current`, invokes the bundled Node executable,
and forwards arguments to the active `personal-agent` JavaScript entrypoint. It
does not parse product command output or access product databases.

Installer state contains release identifiers, paths, timestamps, and sanitized
failure codes only. Secrets and mutable product state remain under `data-root`.

### 4. Make fresh installation one closed transaction

A fresh installation executes the following state machine:

```text
preflight
  -> verify package signature, manifest, checksums, platform, disk, and paths
stage
  -> extract bundled runtime and Node payload into an inactive release directory
initialize
  -> create the local Site, data directories, secret material, and local auth state
activate
  -> atomically switch current while retaining previous
service
  -> register and start the per-user platform service
accept
  -> wait for supervisor, gateway, Console, and authenticated setup endpoint
handoff
  -> open a single-use loopback setup session in the default browser
commit
  -> record the successful installation and prune only releases outside rollback
```

Any failure before `commit` stops the candidate service, restores the previous
pointer and service definition when present, and retains a sanitized diagnostic
record. It never deletes the data root.

Upgrade uses the same transaction without repeating user onboarding. Rollback is
owned by the Go setup executable so it remains available when the current Node
application cannot start.

### 5. Bootstrap local authentication without printing a password

On fresh installation, the setup executable creates a random, single-use setup
nonce in a mode-restricted file under the data root. The nonce:

- has at least 256 bits of entropy;
- expires within five minutes;
- is accepted only through the loopback origin;
- is consumed atomically once;
- is never printed, logged, written to installation metadata, or included in
  acceptance evidence;
- returns a host-only setup session and immediately redirects to a clean
  `/app/setup` URL with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The Setup Center asks the user to establish durable local authentication. The
target representation stores a salted password verifier or platform-backed
credential, not a recoverable plaintext password. Migration from the current
environment password is a separate compatibility step and must preserve rollback.

### 6. Introduce one versioned setup contract

Node owns a versioned setup snapshot. Installer progress may be adapted into this
contract after Node starts, but the Node control service is its source of truth for
product checks.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-15T00:00:00.000Z",
  "readiness": {
    "console": "ready",
    "agent": "action-required",
    "remote": "not-selected",
    "mail": "not-selected"
  },
  "checks": [
    {
      "id": "agent.codex.handshake",
      "group": "agent",
      "requirement": "required-for-agent",
      "state": "action-required",
      "summary": "Codex needs attention",
      "evidence": { "installed": false },
      "actionIds": ["agent.codex.install-guide"],
      "checkedAt": "2026-07-15T00:00:00.000Z"
    }
  ]
}
```

Allowed readiness values are:

- `ready`
- `action-required`
- `blocked`
- `not-selected`
- `checking`

Allowed requirement values are:

- `required-for-console`
- `required-for-agent`
- `conditional`
- `optional`

The product exposes multiple readiness dimensions instead of one misleading
`complete` boolean. A local-only user can have `console=ready` and `agent=ready`
while `remote=not-selected`, `mail=not-selected`, and WeChat remains optional.

All evidence fields are allowlisted and redacted by schema. Error stacks, command
lines containing secrets, environment values, OAuth state, device codes, tokens,
mail content, and conversation content are forbidden.

### 7. Make `/app/setup` the normal onboarding surface

The Setup Center groups checks in this order:

| Group | Checks | Completion meaning |
| --- | --- | --- |
| Installation | release, data root, service, supervisor, gateway, Console | authenticated local Console works after restart |
| Agent | Codex executable, supported version, authentication, app-server handshake, real Web conversation | a real Agent reply is observed in the same authenticated `/app/chat` session |
| Connectivity | selected mode, browser authorization, enrollment, tunnel, DNS, TLS, remote route | selected remote mode is externally usable |
| Agent mail identity | public domain and matching Agent address | identity is bound; no delivery claim is made |
| Local mail | source connector/MTA, ingest shim, real `.eml`, `/app/mail`, backup/restore | actual local mail workflow is operational |
| Optional channels | WeChat and later channels | selected channel is healthy without gating Web use |

Every card shows a human summary, evidence safe to display, why it matters, the
next action, and a retry button. Missing optional capabilities use neutral
`not-selected`, not a failure color.

The Console must not present raw JSON as the default user experience. Advanced
users may expand sanitized details or copy a diagnostic identifier.

### 8. Keep detection read-only and govern repairs

The public automation surface becomes:

```text
personal-agent setup status --json
personal-agent setup open
personal-agent doctor --json
```

`doctor` and `setup status` remain R0 and never mutate state. `setup open` only
opens the authenticated loopback Setup Center and never prints its setup nonce.

Setup actions reuse the operation protocol:

```text
GET  /api/system/setup
POST /api/system/setup/actions/<action>/plan
POST /api/system/setup/actions/<action>/approve
POST /api/system/setup/actions/<action>/execute
```

Mutation routes are `local-admin`, deny remote invocation, and require the
existing plan digest and local human approval for R2/R3. An action may be:

- an automatic safe repair;
- a browser authorization handoff;
- a platform settings link;
- a precise human guide followed by retry.

The Console never constructs arbitrary shell commands from remote input. Native
repair requests are typed, versioned operations accepted by the Go setup
executable over a local, authenticated IPC boundary.

### 9. Detect Codex as a real runtime, not a path

Codex is evaluated in four independent checks:

1. a trusted executable is discoverable;
2. its version is within the supported range;
3. `codex app-server` starts and completes the expected protocol handshake;
4. authenticated `/app/chat` sends a unique acceptance prompt to the real runtime
   and observes the Agent reply in the same session.

The installer does not initially bundle Codex. Its independent release, license,
authentication, and update policy must be reviewed before that can change. When
Codex is missing or signed out, Setup Center gives an official install or login
path and then retries detection.

Repository compatibility bridges for Claude, Cursor, and generic Agent clients do
not count toward installed-product readiness. The installed runtime materializes
only the canonical customer workspace and the Codex-facing integration required
by the accepted product contract.

### 10. Make managed connectivity one user flow with separate credentials

When the user selects Managed Cloud, Setup Center starts a browser authorization
flow through the public provider contract. One user-facing flow may produce
separate purpose-bound enrollment and resource grants internally; their tokens,
lifetimes, storage, and permissions remain separate.

The local flow proves, in order:

1. the owning account approved the browser request;
2. the one-time enrollment credential was consumed;
3. Node enrollment and heartbeat succeeded;
4. redacted domain and Agent mail identity were synchronized;
5. tunnel, DNS, TLS, authenticated remote `/app`, and remote `/app/chat` checks
   passed.

Cloud remains optional. A missing Cloud account or public domain does not make
local Console or local Agent readiness fail.

### 11. Separate mail identity from mail operation

Setup and status use separate facts:

- `agentMailIdentity`: a matching address is assigned to the public domain;
- `localMailIngest`: the local shim and its user-managed source are ready;
- `mailDelivery`: a real message reached authenticated `/app/mail`;
- `mailRecovery`: the message and attachments survived backup and restore;
- `mailOperational`: true only when the independently required delivery facts pass.

The Node package still does not bundle a public SMTP/IMAP service or infer raw
mail support from an HTTPS page. The setup action may guide a user to an existing
mail connector or a reviewed local MTA plan; execution remains preview-only until
locally approved.

### 12. Move WeChat after core Web readiness

WeChat remains a visible recommended channel, but it is optional and appears
after Installation and Agent readiness. Fresh-install acceptance opens Setup
Center, not WeChat binding. Post-binding capability notification remains a
WeChat-channel acceptance fact, not an installation prerequisite.

### 13. Replace prompt-based support with sanitized diagnostics

The Cloud and Node user interfaces do not use a long Agent prompt as the primary
installation action. Advanced support may export a schema-validated diagnostic
bundle containing only release identifiers, check IDs, states, sanitized error
codes, timestamps, and a diagnostic digest.

A user may voluntarily give that bundle to a support person or development Agent.
The support path handles exceptional failures; it is not the installer.

## Language decision

### Selected: Go for the native setup executable and launcher

Go best fits this narrow component because it provides one statically compiled
codebase, direct Windows/macOS/Linux targets, a strong standard library for HTTPS,
JSON, hashing, signatures, archives, processes, and filesystems, and relatively
low maintenance cost for a small team. Official Go tooling uses `GOOS` and
`GOARCH` to select operating-system and architecture targets.

The setup binary will prefer the standard library, disable CGO unless a reviewed
platform requirement proves otherwise, pin every dependency, produce an SBOM,
and run acceptance on native CI hosts before signing.

### Retained: Node.js for the product

The existing Node code owns the Console, HTTP services, conversation, Cloud
provider client, Skills, mail, and automation. Rewriting these domains would add
risk without improving installation. Bundling an exact Node runtime removes the
user-facing Node.js prerequisite while preserving the product implementation.

### Not selected now: Rust

Rust is a strong candidate when a component needs long-lived privileged native
code, low-level networking, a desktop shell, or strict control of memory and
binary footprint. Its official targets cover the required platforms. The current
installer is mostly verified download, filesystem, process, and service
orchestration, while the product intentionally remains a Web Console. Rust would
therefore add build and contributor complexity without enough current benefit.

Reconsider Rust if Personal Agent later owns a persistent native tunnel, OS
credential broker, filesystem watcher with elevated privileges, or desktop tray.
That decision would be scoped to the native subsystem, not a Node product rewrite.
ADR 0005 subsequently selects Rust and Tauri only for the optional desktop window;
the Go setup and launcher remain the installation and recovery root of trust.

### Not selected: Node.js Single Executable Applications

Node 22 SEA can remove the host Node prerequisite, but the pinned Node 22 feature
is experimental, supports one embedded CommonJS entry script, requires binary
blob injection, and changes normal file-based module loading. The Personal Agent
release has ESM, dynamic modules, child processes, and many runtime assets. SEA
would make the recovery installer depend on the same runtime and packaging model
it must be able to repair.

SEA may be reevaluated for the stable launcher after the application is already
installed, but it is not the recovery root of trust.

### Not selected: Deno compile

`deno compile` supports convenient cross-target self-contained binaries, but it
introduces a second JavaScript runtime and its own compatibility and bundling
rules while the application still requires Node.js. It does not reduce the
overall release or acceptance surface.

### Not selected: platform-specific C#, Swift, or shell installers

Separate Windows and macOS implementations would multiply behavior and recovery
paths. Shell and PowerShell remain useful development helpers but are not a
portable customer installation contract.

## Build and release contract

The release workflow will:

1. build and test the Go setup and launcher;
2. acquire the exact Node runtime from a pinned upstream release and verify its
   upstream checksum;
3. build the existing immutable Node payload;
4. generate a manifest covering every packaged byte, licenses, and SBOM;
5. assemble platform packages on native CI hosts;
6. run fresh-install, restart, upgrade, failed-candidate rollback, explicit
   rollback, and uninstall-preserves-data acceptance in clean virtual machines;
7. sign/notarize stable platform packages, or record native signing as explicitly
   deferred for a semantic-version prerelease;
8. publish the package, checksums, detached provenance, and SBOM as one immutable
   GitHub Release;
9. install that public asset on a fresh customer-like machine for release and
   final acceptance.

Checksums published beside an artifact are an integrity check, not a substitute
for platform signing or release provenance.

### Prerelease signing policy

Native commercial signing is optional only for semantic-version prereleases such
as `beta` and `rc`. An unsigned prerelease must publish `RELEASE-SECURITY.json`
with `nativePlatformSigning.status=deferred-prerelease`, state that Windows or
macOS may require explicit user approval, and publish SHA-256 checksums, keyless
Sigstore bundles, GitHub build provenance, and an SBOM for every release. It must
remain marked as a GitHub prerelease and cannot be used as final acceptance
evidence for native platform trust.

A stable tag has no such exception. Its workflow requires Authenticode for
Windows and Developer ID signing plus notarization for macOS, and fails closed
before publication when those credentials are unavailable.

## Migration plan

### Phase A: accept the new product contract

- Review and accept this ADR.
- Update the private normative architecture and acceptance checklist.
- Replace the release-installation baseline requirement that points first to
  WeChat with a Setup Center requirement.
- Remove the installed-product requirement for five Agent compatibility bridges;
  retain repository Harness acceptance separately.
- Add a setup-check registry and JSON schema.

No public installation claim changes before these contract changes are accepted.

### Phase B: close the existing Node installation loop

- Factor current init, prepare, service activation, health wait, and rollback into
  reusable Node domain operations.
- Add the setup snapshot service and expanded read-only doctor checks.
- Add `/app/setup` with Installation and Codex groups.
- Keep the current JavaScript installer as a transitional development path.

### Phase C: introduce the Go setup and launcher

- Add the internal Go module without registering a new product.
- Implement manifest verification, staging, pointer activation, service adapters,
  rollback, loopback browser handoff, and typed local IPC.
- Make the launcher use the bundled Node runtime and active release.
- Test all supported OS/architecture combinations on native runners.

### Phase D: ship self-contained platform packages

- Bundle Node runtime and immutable payload.
- Add platform signing, notarization, SBOM, provenance, and clean-machine tests.
- Publish full offline-capable packages.
- Make the website download the matching platform package by default.

### Phase E: complete guided optional setup

- Move Managed Cloud browser authorization into Setup Center.
- Add public-domain, tunnel, DNS, TLS, Agent mail identity, real local mail, and
  optional WeChat cards.
- Add sanitized diagnostic export.
- Remove the long copyable Agent installation prompt from the normal UI and docs.

### Phase F: remove transitional installation paths

- Stop advertising direct JavaScript installer execution.
- Remove host Node.js from customer prerequisites.
- Preserve a documented recovery package and previous-release rollback.
- Verify upgrade from the final JavaScript-installer release to the first Go
  setup release.

## Acceptance

A Node release using this design passes only when sanitized evidence proves:

1. A user installs a public platform asset on each supported OS without a source
   checkout, development Agent, preinstalled Node.js, or manual CLI command.
2. The manifest, checksums, Sigstore bundle, provenance, SBOM, and explicit native
   signing status identify the exact immutable release; stable releases additionally
   prove Authenticode and Developer ID/notarization.
3. Installation initializes secrets, registers and starts the service, opens a
   one-time loopback Setup Center session, and prints no secret.
4. Restart preserves authenticated Console access and mutable state.
5. Setup Center accurately distinguishes `console`, `agent`, `remote`, and `mail`
   readiness and provides actionable remediation.
6. Codex installation/authentication/handshake failures do not break Console, and
   Agent readiness becomes true only after the real same-session Web conversation
   check passes.
7. Local-only Console and Agent readiness pass with Cloud disconnected.
8. Selecting Managed Cloud proves browser authorization, enrollment, heartbeat,
   public route, DNS, TLS, and authenticated remote Web access without exposing a
   device code or token.
9. Agent mail identity never sets `mailOperational`; a real local message and
   recovery evidence do.
10. WeChat is optional and does not block Web conversation acceptance.
11. A failed candidate automatically restores the previous release, and explicit
    rollback remains available even when the current Node process cannot start.
12. Uninstall removes product binaries and services only after explicit local
    approval and preserves the data root by default.
13. Installer, Console, CLI, and acceptance all consume the same versioned setup
    check schema.

## Consequences

- The release matrix and signing workload increase because the product ships real
  platform packages rather than one universal JavaScript bootstrapper.
- Customer installation becomes deterministic and supportable without an Agent.
- Node.js remains the dominant product language; Go stays a deliberately small
  lifecycle boundary.
- Setup and health become explicit product domains instead of scattered CLI
  output and UI fragments.
- Optional features no longer make the product look broken when a user has not
  selected them.
- Repository Harness compatibility remains testable without forcing every
  compatibility bridge into installed-product readiness.

## References

- [Node.js 22 Single executable applications](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html)
- [Go operating-system and architecture targets](https://go.dev/doc/install/source#environment)
- [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html)
- [Deno compile and cross compilation](https://docs.deno.com/runtime/reference/cli/compile/)

## Verification

Implementation and coordinated contract changes use:

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```

The architecture document, behavior baseline, test fixtures, public
documentation, and private acceptance checklist change in the same coordinated
milestone. A release cannot claim this ADR from the document alone; every
acceptance item above requires runtime or artifact evidence.
