# ADR 0003: Core/workspace delivery and one Next.js application

- Status: Accepted
- Date: 2026-07-15
- Scope: Public Personal Agent Node repository and installed layout
- Supersedes: the source-layout and installed-root examples in ADR 0001 and ADR 0002
- Preserves: the product, security, setup, rollback, and behavior contracts in ADR 0001 and ADR 0002

## Context

Personal Agent Node is one customer-machine product, but its implementation is
split across historical directories under `projects/core`: Node lifecycle code,
Open Agent Bridge, a handwritten administration server, channel adapters, and
several independent page renderers. Those directories are not independent
products or deployment units. They create separate package manifests, build
steps, page systems, and path conventions without providing an isolation or
ownership benefit.

The installed system also presents immutable program files and mutable user data
as unrelated roots. A customer should instead see one Personal Agent home with
two explicit ownership domains: product-owned `core` and user-owned `workspace`.

## Decision drivers

1. One product must have one understandable application architecture.
2. The Web Console, Setup Center, chat, mail, files, data, skills, channels, and
   update surfaces must share one design system and routing model.
3. Long-lived Codex, worker, WebSocket, backup, gateway, and service processes
   must retain stable Node process boundaries even when the source project is
   unified.
4. Upgrades and rollback must replace only immutable product bytes.
5. Harness files, plugins, user files, databases, logs, secrets, and generated
   content must be visibly user-owned and survive uninstall by default.
6. Extensions need a versioned contract, permission declaration, and lifecycle;
   they must not patch framework internals or arbitrary routes.
7. The public release must remain self-contained on Windows, macOS, and Linux.

## Decision

### 1. Remove the historical `projects` layer

The repository uses these product directories:

```text
core/
  app/          Next.js App Router UI and BFF
  runtime/      lifecycle, gateway, setup, backup, providers, stable CLI
  agent/        sessions, Codex app-server, workers, automation, local data
  channels/     bundled channel and managed-platform adapters
  edge/         optional self-hosted transport implementation
  plugins/      plugin SDK, schemas, loader, and bundled manifests
workspace/      seed Harness and user-owned directory contract
```

`scripts`, `test`, `docs`, and release metadata remain repository-development
surfaces. There is no `projects` directory and no product registry entry may
point through one.

Source modules may keep internal process boundaries. A process boundary does not
create another npm workspace or product. The repository has one JavaScript
package and one dependency lock; Go remains an internal native module for setup
and launch.

### 2. Use Next.js as the unified full-stack application

`core/app` uses Next.js App Router, React, and TypeScript. It owns:

- the authenticated application shell and navigation;
- Setup Center, chat, mail, files, data, skills, channels, plugins, and updates;
- Server Components for local reads and Route Handlers for the versioned BFF;
- shared components and design tokens derived from `DESIGN.md`;
- production standalone output included in the immutable core release.

The application runs only on the Node.js runtime. Edge/serverless runtime
assumptions are forbidden. Dynamic customer data is not statically generated or
cached across users.

Next.js does not own long-lived product work. Codex app-server, workers,
WebSockets, channel polling, backup scheduling, gateway policy, and native
service control remain internal services under `core/runtime` and `core/agent`.
The BFF calls typed local service contracts. Server Actions are not used as a
background job system.

The standalone build copies its public and static assets into the release. The
build ID is the immutable release revision so browser assets cannot drift across
`current` activation.

### 3. Adopt one installed Personal Agent home

The canonical installed layout is:

```text
<personal-agent-home>/
  core/
    bin/
      personal-agent[.exe]
      personal-agent-setup[.exe]
    releases/
      <release-id>/
        core/
          app/
          runtime/
          agent/
          channels/
          plugins/
        workspace/        versioned seed only
        runtime/          bundled Node.js executable
        release-manifest.json
        SBOM.cdx.json
    current -> releases/<release-id>
    previous -> releases/<previous-id>
    installation.json
  workspace/
    AGENTS.md
    registry/
    skills/
    workflows/
    plugins/
    files/
    publications/
    databases/
    mail/
    backups/
    config/
    secrets/
    runtime/
    logs/
```

`core` is product-owned and immutable except for atomic release pointers and
sanitized installation metadata. `workspace` is user-owned and mutable. Upgrade,
rollback, and uninstall never replace or delete `workspace` by default.

The installer accepts one home path. Legacy separate install/data roots are
detected and migrated through an explicit, rollback-safe operation. Compatibility
environment names may be read during migration, but new state is resolved from
the home contract.

### 4. Ship the Harness inside `workspace`

The customer Harness is not a development-agent prompt. It is the operational
contract stored in the user's workspace:

- `AGENTS.md` describes local ownership and safety;
- `registry` declares skills, plugins, routes, commands, and capabilities;
- `skills` and `workflows` are directly inspectable and user-extensible;
- generated Codex compatibility paths point into the workspace Harness;
- user files and data live beside the Harness, never inside immutable releases.

Release packaging contains a versioned workspace seed. Installation and upgrade
copy missing seed files and perform schema migrations without overwriting user
content. Core defaults remain available for diff and recovery.

### 5. Introduce a versioned plugin contract

Every plugin has a `personal-agent.plugin.json` manifest with:

- `apiVersion`, `id`, `version`, and compatibility range;
- declared capabilities and permissions;
- optional navigation, page, API, worker, channel, and scheduled-task
  contributions;
- a code directory confined to `workspace/plugins/<id>` and a mutable data directory confined to `workspace/data/plugins/<id>`;
- lifecycle hooks that are explicit operations, never npm install scripts.

Plugins are installed into the workspace, validated against the bundled schema,
and activated by a core loader. A plugin cannot shadow fixed authentication,
setup, update, or internal routes. UI contributions use registered slots and
typed JSON view models; arbitrary server-side React code from the workspace is
not loaded into the trusted application process.

Bundled channels can adopt the same manifest contract as later third-party plugins.
Permissions are visible in the Console and mutations retain the R0-R3 approval
model.

### 6. Preserve the existing behavior and trust contracts

This restructuring does not weaken:

- local-only operation and optional Cloud;
- authenticated loopback administration;
- Codex real-runtime acceptance;
- immutable releases and previous-release rollback;
- independent domain, tunnel, token, mail, and channel providers;
- local-only customer data and secret redaction;
- native package verification, SBOM, provenance, and prerelease signing policy.

Routes may move between internal handlers, but their public patterns and access
levels remain governed by `registry/routes.json` until a coordinated contract
change is accepted.

## Migration sequence

1. Add this ADR, delivery registry, plugin schema, and path-aware guards.
2. Create `core/app` and the shared `DESIGN.md` token implementation.
3. Move runtime, Agent, channel, and Edge sources into `core` while updating all
   registries, imports, scripts, tests, and release builders atomically.
4. Replace handwritten Web rendering route-by-route with Next.js pages and BFF
   handlers. Remove each old renderer with its accepted replacement.
5. Change release staging and the Go installer to produce and activate
   `core/workspace`.
6. Exercise upgrade from the last separate-root release, rollback, restart,
   plugin installation, and uninstall-preserves-workspace.
7. Publish only after native CI and public-asset acceptance pass.

## Consequences

- The migration is a large one-time change, but removes recurring cross-package
  and cross-renderer maintenance.
- Next.js is an application and BFF boundary, not the supervisor or job system.
- One root package increases the importance of internal dependency rules; guards
  enforce imports and fixed service boundaries.
- Workspace plugin code is less trusted than core code and is deliberately
  constrained to manifests, local processes, and typed view contributions.
- User-visible design becomes consistent and traceable to `DESIGN.md`.

## Verification

```bash
npm run doctor
npm run guard
npm run baseline:replay
npm test
npm run check
npm run build
npm run release:build
```

Release acceptance additionally installs the public platform artifact, verifies
the exact `core/workspace` layout, completes authenticated `/app/chat` against the
real Codex runtime, exercises one plugin lifecycle, rolls back, and confirms that
uninstall preserves `workspace`.
