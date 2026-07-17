# ADR 0006: Local Personal Apps and update compatibility

- Status: Accepted
- Date: 2026-07-16
- Scope: Public Personal Agent Node repository and installed Workspace
- Related: ADR 0003 Core/workspace delivery, ADR 0004 managed reverse tunnel,
  ADR 0005 Tauri desktop shell

## Summary

Personal Agent Node is a complete local-first product. It owns the Agent runtime,
mail, local data, Online Pages, authentication, application hosting, update, and
rollback. Managed Cloud and self-hosted Edge are optional connectivity providers;
they are not application runtimes or capability providers.

Personal Apps are user-owned applications under `workspace/apps`. An Agent may
create and rewrite an App freely without modifying immutable Core releases. Apps
use a same-origin, versioned Personal Agent Node Local API and continue to run in
local-only mode. Optional tunneling only transports allowed requests to the Node
gateway.

The first release deliberately supports trusted local static/PWA Apps. It does
not introduce a marketplace, third-party package installation, a permission
sandbox, arbitrary server processes, or plugin contribution points.

If accepted, this ADR narrows ADR 0003 section 5: Plugin v1 remains a process
extension mechanism during migration, while user-created pages and replacement
clients move to Personal Apps.

## Context

Plugin v1 currently combines navigation, views, Agent tools, workers, channels,
and schedules in one manifest. Only some process contributions are consumed by
the runtime. The contract is heavier than the immediate product requirement:
an Agent should be able to create a custom application or client using the
Node-owned mail, data, and Online Pages capabilities.

Directly modifying release-owned Console, desktop shell, runtime, or gateway
files conflicts with automatic updates. An updater can overwrite a customization,
preserve an obsolete file, or request a semantic merge; it cannot guarantee both
arbitrary in-place Core edits and conflict-free upgrades.

The existing architecture already supplies useful foundations:

- immutable `current` and `previous` Core releases with rollback;
- a Workspace preserved by install, update, rollback, and default uninstall;
- authenticated local gateway routing shared by local and tunneled access;
- existing mail, Agent data, and Online Pages handlers;
- a small desktop shell that loads the loopback gateway;
- encrypted Workspace backup and restore.

It does not yet supply:

- `workspace/apps` as a governed user-owned boundary;
- a static App host and reserved authenticated App route;
- a stable Node Local API contract for Apps;
- default-App selection with recovery fallback;
- App compatibility checks during Core update;
- App-aware backup, distribution, CLI, and acceptance coverage.

## Decision drivers

1. Node must remain fully usable in local-only mode and must make no Cloud call
   merely because an App is installed or running.
2. Cloud or Edge may transport requests but must not own App code, App data,
   mail, Agent data, Online Pages, authentication, or update state.
3. An Agent must be able to create and iterate an App by writing ordinary files
   under Workspace.
4. Official Core updates must not overwrite user App source or data.
5. The official Console must remain available as a recovery surface.
6. The first implementation must stay smaller than a general plugin ecosystem.
7. Public and untrusted third-party distribution must not be implied by a local
   trusted-App design.

## Terminology and ownership

| Term | Owner | Meaning |
| --- | --- | --- |
| Personal Agent Node | Core release plus Workspace | Complete local product |
| Core | Product | Immutable runtime, Console, gateway, desktop shell, and local services |
| Workspace | User | Mutable Harness, Apps, files, databases, mail, Pages, and configuration |
| Personal App | User or local Agent | Trusted local static/PWA application using Node capabilities |
| Node Extension | User or product | Optional process adapter such as a channel or background integration |
| Connectivity Provider | Optional external or self-hosted service | Transports allowed requests to the Node gateway |
| Core Customization | User development branch | Source-level changes maintained as patches and custom releases |

## Product invariants

The following are release-blocking invariants:

- `local-only` starts no managed connector and Apps remain usable.
- Apps depend on Personal Agent Node, never on a managed Cloud API.
- The same App code works through loopback, LAN when enabled, managed tunnel, or
  self-hosted transport.
- Connectivity providers terminate at the fixed Node gateway and cannot bypass
  its route and authentication policy.
- App source, build output, and App-owned data remain under Workspace.
- Core activation and rollback never overwrite an existing App file. A release
  may add a missing product reference App or missing reference file through the
  Workspace seed merge.
- An invalid or incompatible App cannot make Node, Setup, Update, or the official
  Console unavailable.

## Personal App v1

### Filesystem layout

```text
<personal-agent-home>/
  workspace/
    apps/
      <app-id>/
        personal-agent.app.json
        src/                 optional user source
        dist/                static build output
        data/                optional App-owned mutable data
    config/
      apps.json              default App and local App state
```

`workspace/apps` is included in Workspace backup and restore. Core releases do
not contain reference or customer Apps, and installation never copies App seed
files into this user-owned directory. Development references may live under the
source repository's `examples/` tree, which is excluded from release artifacts.

### Minimal manifest

```json
{
  "apiVersion": "personal-agent/app-v1",
  "id": "example.family-dashboard",
  "name": "Family Dashboard",
  "entry": "dist/index.html",
  "requires": {
    "nodeApi": "1"
  }
}
```

Required fields are limited to identity, static entry point, and Node Local API
compatibility. App version, description, icon, and development metadata may be
optional. App v1 has no permissions array and no contribution-point model.

The manifest and loader must reject absolute paths, `..`, links escaping the App
root, missing entry files, duplicate IDs, reserved IDs, and unsupported API
versions. The directory name must equal the manifest ID.

### Trust model

App v1 is trusted local owner code. It runs with the authority of the currently
authenticated owner session and may call the documented Node Local API. The
Console must label this model accurately; it must not claim sandboxing or
per-capability isolation.

Downloaded third-party Apps are out of scope. If later supported, they require a
separate decision for provenance, signatures, scoped credentials, permissions,
revocation, and process isolation.

### Hosting and routes

Core reserves:

```text
/apps/<app-id>/...
```

App v1 routes are authenticated and never public. Public content continues to use
Online Pages and its separate publication policy.

The gateway resolves files only below the directory containing `entry`. It must:

- use a confined real path and reject symbolic-link escapes;
- deny dotfiles, source maps by default, manifests, source directories, secrets,
  databases, and unknown MIME types;
- serve immutable asset cache headers only for content-addressed assets;
- use `entry` as the SPA fallback for route paths without a file extension;
- preserve fixed precedence for login, Setup, Update, internal APIs, and the
  official Console.

The App catalog is scanned from manifests. A separate mutable registry is not a
source of truth in v1.

### Default App and recovery

`workspace/config/apps.json` may select one `defaultAppId`.

- `/app` remains the permanent official Console and recovery route.
- `/` resolves to the compatible default App when configured.
- `/` resolves to `/app` when no default App is configured.
- Missing, invalid, disabled, or incompatible default Apps fall back to `/app`.
- Setup bootstrap continues to open its explicit `/app/setup/bootstrap` route.
- The desktop shell opens `/` after readiness instead of hard-coding `/app`.

This keeps the native shell product-owned and updateable while allowing a
Workspace App to replace the normal client experience.

## Personal Agent Node Local API v1

The Local API is part of Node and is available on the loopback gateway without
Cloud. It is not a platform or managed-service dependency.

App v1 uses same-origin authenticated HTTP. It does not receive internal service
tokens, database paths, or direct SQLite access. Initial routes are deliberately
narrow:

```text
GET  /api/node/v1/capabilities
GET  /api/node/v1/mail/messages
GET  /api/node/v1/mail/messages/:id
GET  /api/node/v1/data/schema
POST /api/node/v1/data/query
POST /api/node/v1/data/distinct
GET  /api/node/v1/pages
POST /api/node/v1/pages
GET  /api/node/v1/apps/<app-id>/history
POST /api/node/v1/apps/<app-id>/history
```

The first version wraps existing Mail, Agent Data, and Online Pages services. It
also provides a bounded App history ledger under the matching App's own
directory. The ledger is append/list only, requires a matching declared App ID,
and does not expose a database or general write API. It does not expose raw SQL,
snapshot restore, system configuration, plugin lifecycle, update operations,
tunnel credentials, or internal tokens.

Every response uses a versioned JSON envelope and machine-readable error shape.
The capability response reports supported API majors and optional capability
details. Request and response schemas live with Core and are exercised against
the real underlying handlers.

Core supports the current Node Local API major and the immediately previous major
for at least one stable release cycle. Deprecation must be visible before removal.

## Agent development workflow

No package installation operation is required for a locally created App:

1. The Agent creates `workspace/apps/<id>`.
2. It writes or builds static files and the minimal manifest.
3. It runs `personal-agent app verify <id> --json`.
4. The user or Agent may run `personal-agent app set-default <id> --json` through
   the normal risk and approval policy.
5. The App is available at `/apps/<id>/` after a catalog reload or Node restart.

Initial CLI surface:

```text
personal-agent app list
personal-agent app inspect <id>
personal-agent app verify <id>
personal-agent app set-default <id>
personal-agent app clear-default
```

Create, edit, build, and remove remain ordinary Workspace file operations owned
by the local user and Agent Harness. A future Console management surface is a
major UI change and requires a separately approved prototype before implementation.

## Update and compatibility behavior

Core update remains independent of Cloud and may use an official release asset,
an approved mirror, or a manually supplied verified artifact.

Before candidate activation, the installer or preparation command scans App
manifests and records a sanitized compatibility report:

```json
{
  "compatible": ["example.family-dashboard"],
  "incompatible": [
    {
      "id": "example.legacy",
      "requiredNodeApi": "1",
      "candidateNodeApis": ["2"]
    }
  ],
  "invalid": []
}
```

An incompatible App does not block a verified Core security or feature update.
The App remains on disk, is not served by the candidate Core, and cannot remain
the effective default. Node falls back to the official Console and reports the
compatibility issue. The user may explicitly roll Core back or ask an Agent to
migrate the App.

Core health, migration, or service activation failures still trigger automatic
candidate rollback. App compatibility alone does not rewrite `current` or
`previous` and never modifies App files.

## Relationship to Plugin v1 and Node Extensions

This decision does not require an immediate destructive plugin migration.

- Existing Plugin v1 lifecycle and tests remain during transition.
- Personal Apps replace Plugin navigation and view ambitions.
- Process-based workers, channels, and background integrations may later move to
  a smaller `Node Extension` contract.
- Agent tools remain an Agent runtime contract, not an App UI contribution.
- Schedules remain owned by Node automation unless an accepted Extension contract
  defines otherwise.
- Plugin Studio is not renamed or redesigned as part of this ADR. Any such UI
  change requires the design-review gate.

## Core customization mode

Direct Core modification remains possible in a source checkout, but it is not an
App and does not receive the App update guarantee.

A future development guide may define:

```text
upstream release base
+ user patch series
+ custom acceptance tests
= custom immutable release
```

An upgrade assistant may stage a new upstream source tree, reapply patches,
explain conflicts, run acceptance, and build a custom release. It must never call
this conflict-free automatic update. This workflow is not part of App v1.

## Implementation map

### New product-owned surfaces

| Area | Proposed location | Work |
| --- | --- | --- |
| App schema and types | `core/apps/schema`, `core/apps/sdk` | Minimal manifest validation |
| App catalog | `core/runtime/src/apps.ts` | Scan, verify, compatibility, default resolution |
| Static App host | `core/runtime/src/gateway.ts` or a small imported module | Confined authenticated file serving and SPA fallback |
| Node Local API | `core/agent/src/server` plus contract modules | Versioned adapters over Mail, Data, and Pages |
| CLI | `core/runtime/bin/personal-agent.mjs` | List, inspect, verify, set/clear default |
| Desktop entry | `core/desktop` | Open `/`, retain explicit Setup bootstrap |
| Update preflight | native installer and runtime preparation | Report compatibility without modifying Apps |
| Backup and restore | `core/runtime/src/backup.ts` | Include `apps` and App configuration |
| Delivery | release builder, installer seed, registries | Add Workspace Apps without packaging customer data |
| Harness | Workspace AGENTS and development guide | Agent-safe create, verify, migrate workflow |

### Existing implementation to reuse

| Existing capability | Reuse assessment |
| --- | --- |
| Immutable `current` / `previous` releases | High; no release model replacement |
| Workspace preservation and missing-only seed merge | High; add Apps to declared and tested roots |
| Gateway authentication and optional tunnel termination | High; add authenticated dynamic App route |
| Mail, Agent Data, and Online Pages handlers | Medium-high; require stable schemas and adapters |
| Plugin manifest/store patterns | Medium; reuse confinement tests, not the contribution model |
| Tauri loopback shell | High; change default path and tests only |
| Backup/restore | Medium-high; include and validate App trees |

## Delivery phases and engineering cost

Estimates are engineering days for an experienced contributor familiar with the
repository. They include implementation and focused tests, but not user review
latency. The current dirty migration worktree must be stabilized before these
changes are integrated.

| Phase | Scope | Estimate |
| --- | --- | ---: |
| 0. Contract freeze | Accept ADR, schemas, route and threat-model review | 3-4 days |
| 1. Workspace Apps | Manifest, catalog, confined static host, authenticated `/apps` route, CLI verification | 8-12 days |
| 2. Node Local API v1 | Capability endpoint, Mail/Data/Pages adapters, schemas, error contract, tests | 10-15 days |
| 3. Default client | Default resolution, `/` fallback, desktop shell path, recovery tests | 5-8 days |
| 4. Update and persistence | Candidate compatibility report, backup/restore, release seed and registries | 7-10 days |
| 5. Agent workflow | App template, SDK helper, development and migration guide | 5-8 days |
| 6. Release hardening | Cross-platform, local-only, tunnel parity, upgrade/rollback, security and acceptance coverage | 8-12 days |
| **Release-ready total** | Phases 0-6 | **46-69 engineering days** |
| **Planning total with 20% contingency** | Migration overlap and contract discoveries | **55-83 engineering days** |

Expected calendar time:

- one engineer: approximately 11-17 weeks;
- two engineers: approximately 7-10 weeks;
- three engineers: approximately 6-8 weeks because contract, update, and
  acceptance work contain serial dependencies.

A technical MVP through phase 4 is 33-49 engineering days. It supports static
Apps, core capability reuse, default selection, preservation, and update fallback,
but not polished templates or full release acceptance.

### Explicitly excluded cost

| Optional expansion | Additional estimate |
| --- | ---: |
| Managed service/SSR Apps with supervised processes and health protocol | 12-18 days |
| Untrusted third-party App install, signatures, permissions, and revocation | 15-25 days |
| Core patch-series upgrade assistant | 15-25 days |
| App management UI after approved prototype | 6-10 days plus design review |
| Native mobile client SDK and reference application | 25-45 days per platform |

## Cost drivers and risks

1. **Local API stability is the largest design cost.** Existing handlers work,
   but their schemas and compatibility promises are not yet a public local App
   contract.
2. **Same-origin trusted Apps are intentionally powerful.** This keeps v1 light,
   but prohibits presenting it as safe for unknown downloaded code.
3. **Static Apps cover custom Web, desktop WebView, and PWA clients.** Supporting
   arbitrary server frameworks immediately would add port allocation, process
   health, secret isolation, logging, restart, and shutdown contracts.
4. **Update must prefer Node recovery over App continuity.** An incompatible App
   falls back to the Console instead of blocking Core security updates.
5. **Current migration work overlaps gateway, installer, desktop, and design
   files.** Implementation should start only after the active worktree is either
   accepted or separated into a clean branch.
6. **UI scope is separate.** CLI and route behavior can ship before an App
   management page. A page or navigation redesign cannot bypass design approval.

## Acceptance criteria

The release-ready implementation is accepted only when all of the following are
demonstrated from a packaged public Node artifact:

1. Install and run in local-only mode without contacting managed Cloud.
2. An Agent creates a static App under Workspace, verifies it, and opens it over
   the authenticated loopback gateway.
3. The App reads approved Mail and Data views and publishes an Online Page through
   Node Local API v1 without direct database or secret access.
4. The same App route works through an enabled connectivity provider without App
   source changes.
5. Selecting the App as default causes `/` and the desktop shell to open it.
6. Deleting, corrupting, or making the default App incompatible falls back to the
   official `/app` Console.
7. Core upgrade preserves compatible Apps and their default selection.
8. Core upgrade preserves but disables an incompatible App and reports why.
9. Failed candidate activation restores `current`, `previous`, and the managed
   service boundary without modifying Apps.
10. Encrypted backup and restore preserve App source, build output, data, and
    default configuration.
11. Existing login, conversation, Pages, backup, rollback, Plugin v1, and tunnel
    baselines continue to pass.
12. Public release contents contain no customer App, credential, private path,
    or mutable runtime state.

## Decisions required before implementation

The recommended answers are part of this proposal and require explicit approval:

1. **App v1 runtime:** static/PWA only; supervised service Apps are deferred.
2. **Trust:** locally created owner-trusted Apps only; downloaded untrusted Apps
   are unsupported.
3. **Default entry:** `/` resolves to the selected App and `/app` permanently
   remains the official recovery Console.
4. **Compatibility:** Core supports the current and immediately previous Node
   Local API major for at least one stable release cycle.
5. **Update policy:** incompatible Apps never block a verified Core update; they
   are preserved, made unavailable, and replaced by Console fallback.
