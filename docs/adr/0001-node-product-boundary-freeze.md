# ADR 0001: Freeze the Personal Agent Node product boundary

- Status: Accepted
- Date: 2026-07-13
- Scope: Public Personal Agent Node repository

## Context

The private workspace owns the normative product architecture for converging the
customer-machine runtime into one Personal Agent Node product with an optional,
independent Edge product. This public repository must be able to implement and
verify that direction without publishing private Cloud implementation or
operations details.

The current source layout contains historical project names and command
surfaces. Moving those sources before their behavior is frozen would make it
difficult to distinguish an intentional migration from a regression.

## Decision

We accept the following public constraints:

1. Personal Agent Node is one customer-machine product and immutable release.
2. Private Site Edge is an optional transport product. Local-only operation is
   a complete supported path.
3. Project, source-module, and operating-system process boundaries are governed
   independently. A process boundary does not create a separate product.
4. Mutable customer data stays under the configured data root. Releases and
   source remain free of credentials, databases, logs, and customer content.
5. Public routes, capabilities, extensions, data access, and risk levels must
   become declared and guardable before source boundaries are moved.
6. The stable future automation surface is the `personal-agent` CLI and its
   public Skill. Historical commands and routes are migration inputs, not the
   target contract.
7. `registry/commands.json` is the declarative truth for the public command
   surface. Default help exposes only `implemented` commands, preview commands
   require explicit `--preview` opt-in and warnings, and `planned` or unknown
   commands always fail closed. `--all` expands help metadata only.
8. Managed Cloud is optional. Its private implementation, operator policy, and
   infrastructure details do not enter this repository.
9. Migration proceeds in phases. A phase may remove old entrypoints when its
   replacement is accepted; the immutable previous release provides rollback.

The Phase 0 behavior freeze is recorded in
`registry/behavior-baselines.json`. Each entry has a reproducible, secret-free
case under `test/fixtures/baseline-cases/` and a command that exercises current
behavior. These baselines protect behavior during later registry, CLI, console,
and source-layout migrations. They do not make historical names permanent.

## Consequences

- Changes to a frozen workflow must update its case and explain whether the
  behavior is preserved, deliberately replaced, or deferred.
- A green Phase 0 baseline proves the named current behavior only. It does not
  prove the target CLI, console, registry, extension, or Cloud architecture is
  complete.
- Later phases must replace references to historical paths in the same change
  that moves their implementation. Compatibility shims are not required.
- This ADR intentionally contains no Cloud source paths, credentials, service
  topology, host inventory, or deployment procedure.

## Verification

```bash
npm run baseline:verify
npm run baseline:replay
```
