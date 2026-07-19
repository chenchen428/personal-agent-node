# ADR 0007: Agent-managed client updates and restart

- Status: Accepted
- Date: 2026-07-17
- Scope: Personal Agent Node desktop client, immutable Core releases, stable CLI, and local operation control
- Related: ADR 0003 Core/workspace delivery, ADR 0005 Tauri desktop shell, ADR 0006 Local Personal Apps and update compatibility

## Summary

Personal Agent should update as one product: the Tauri desktop shell, Node Core,
bundled Node runtime, official Console, and release-owned launchers must move to
the same immutable release. The browser UI and the Agent do not replace program
files directly.

A stable, native update executor outside the active `current` release downloads
and verifies a platform artifact, stages it, asks the desktop shell to drain and
stop the current runtime, atomically activates the candidate, relaunches the
stable desktop entry, and verifies readiness. Failed candidates automatically
restore `previous` and relaunch the known-good release.

The Agent may own checking, planning, safe-window selection, progress reporting,
post-restart continuation, and recovery. Applying or rolling back an update is
an R3 operation. Ordinary customer update and rollback flows require fresh
authenticated local approval. A registered product-development delivery is the
scoped exception: the owner's initiating request authorizes that delivery's exact
revision and digest without a redundant second prompt. Broader standing update
delegation remains a separate R3 local-human policy decision.

## V1 implementation note

The first implementation uses the official GitHub Releases API as its release
index. It allowlists the exact `chenchen428/personal-agent-node` asset path,
requires the platform-specific self-contained updater to have an exact entry in
the release `SHA256SUMS`, verifies the downloaded size and digest, and then
re-verifies the embedded release manifest and payload checksums in the native
executor. Stable Windows and macOS updates additionally fail closed unless the
candidate passes Authenticode or Developer ID verification; prerelease native
signing follows the repository's disclosed deferred-prerelease policy.

The release pipeline continues to publish Sigstore bundles and provenance for
acceptance. Runtime verification of those keyless bundles, or a separate signed
static channel index, remains a release-hardening follow-up and is required
before general standing no-prompt delegation can be enabled. V1 keeps fresh
local-human approval for ordinary updates; the registered product-development
exception does not create a reusable channel policy.

## Existing foundations

The repository already provides:

- immutable releases with `current` and `previous` pointers;
- release manifest and checksum verification;
- candidate preactivation before pointer switching;
- managed-service stop, activation, restart, readiness wait, and failure recovery;
- a stable `personal-agent-setup` binary under `core/bin`;
- a stable `personal-agent-ui` launcher that resolves the active desktop runtime;
- persisted, digest-bound R2/R3 operation plans and local-human approval;
- rollback tests that restore pointers and restart the previous service.

The missing product contract is remote artifact discovery, update metadata and
signature policy, a cross-restart job state machine, a shell handoff protocol,
post-restart acceptance, Agent-facing stable commands, and user-visible status.

## Decision drivers

1. Core and the desktop shell must never drift to different release versions.
2. Workspace data, Apps, skills, mail, databases, secrets, and user files must
   survive update, failed update, rollback, and updater self-upgrade.
3. A compromised page, Personal App, Extension, Worker, or remote session must
   not gain native update or restart authority.
4. The Agent must be able to complete the workflow without pretending that a
   pre-restart process can report post-restart success.
5. A power loss or process crash at any point must leave either the old release
   or the verified candidate recoverable.
6. Local-only installations must remain operable. Update discovery may be
   unavailable offline, but rollback must never require Cloud or GitHub.

## Product boundary

The update unit is the complete platform-specific Personal Agent Node artifact.
It contains the matching Tauri shell, stable launchers, Core application,
runtime services, bundled Node executable, release manifest, checksums, SBOM,
and provenance metadata.

The official Tauri updater plugin is not the primary product updater. It can
verify and install a Tauri application bundle, but Personal Agent also owns the
versioned Node Core and bundled runtime behind `current`. Updating only the app
bundle would create two activation systems and allow shell/Core version drift.
The product instead keeps the existing native installer as the single activation
authority. Tauri's process-relaunch behavior may inform the shell handoff, but
the loopback Web Console receives no Tauri process or updater permission.

## Components

### Release index

The public Node release pipeline publishes one HTTPS update index per channel.
The index is static, cacheable, and contains no owner or machine data:

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "0.3.0",
  "releaseId": "0.3.0+<revision>",
  "publishedAt": "2026-07-17T00:00:00Z",
  "minimumUpdaterVersion": "0.2.0",
  "notesUrl": "https://github.com/chenchen428/personal-agent-node/releases/tag/v0.3.0",
  "artifacts": {
    "windows-x64": {
      "url": "https://.../personal-agent-node-windows-x64.exe",
      "sha256": "...",
      "size": 0,
      "signature": "..."
    }
  }
}
```

Each supported target has its own URL, exact size, SHA-256 digest, and detached
release signature. The updater uses a product public key embedded in the stable
native executor and requires HTTPS, a supported schema, a newer compatible
version, an allowlisted channel, and a matching OS/architecture. Platform code
signing remains required in release acceptance and complements, rather than
replaces, the product release signature.

### Stable update executor

`<home>/core/bin/personal-agent-setup[.exe]` remains outside `current` and owns
artifact verification and activation. To avoid overwriting a running executable
on Windows, the current executor downloads the candidate platform installer to
`workspace/runtime/updates/<job-id>/`, verifies it, and launches that candidate
copy. The candidate performs installation and only then replaces the stable
executor and launchers.

The executor must accept only a persisted approved job ID plus its operation
digest. It re-reads the job from the owner-only Workspace path and rejects raw
release URLs, caller-selected install roots, unsigned local payloads, expired
plans, version downgrades, and digest changes.

### Governed pre-release candidate acceptance

Before a GitHub Release is created, maintainers may validate the exact
self-contained platform updater on the same computer through the updater's
`candidate-plan`, `candidate-approve`, and `candidate-apply` commands. This is
not a second installer path: apply hands the staged updater to the same desktop
lifecycle owner and native immutable installer used by a published update.

The platform builder must opt in with `--candidate`. That embeds
`CANDIDATE-SECURITY.json` in the checksummed payload. The plan rejects a
candidate unless its release manifest, complete `SHA256SUMS`, SBOM, exact Git
revision, candidate security metadata, and OS/architecture all agree. Stable
candidates still require native platform signing; prerelease signing may only
use the explicitly documented deferred-prerelease policy.

Planning copies the exact updater into
`workspace/installation/updates/<job-id>` and binds its SHA-256, size, revision,
current installed release, operation ID, and operation digest for ten minutes.
The R3 operation is written to the personal Space operation store. Ordinary
candidate use is approved through the existing `personal-agent operation approve`
interactive local-TTY flow. For a registered product-development delivery, the
owner's initiating request is standing authorization for only the exact revision
and digest, so the delivery Agent may pass `--authorized-product-delivery` without
a second prompt. Workers, remote callers, and unrelated Agent activity cannot
widen or reuse that authorization. Apply rechecks the approved operation, expiry, artifact bytes, and
installed-state fingerprint before the desktop owner stops the runtime. The
native installer retains `previous`, atomically switches `current`, preserves
Workspace data, and records `succeeded`, `rolled_back`, or `failed`.

Candidate evidence must say `candidateAssetRuntime=true` (or
`releaseAssetRuntime=false`). It never satisfies final acceptance, which still
requires reinstalling the immutable public GitHub Release asset and recording
`releaseAssetRuntime=true`.

### Runtime update coordinator

The control service owns update discovery and the persisted job state. It is the
only runtime component that may convert an approved update operation into a
shell handoff. Web routes and Agent commands call this service; they do not spawn
the installer directly.

The coordinator invokes the stable `personal-agent-ui` launcher with an internal
`--apply-update <job-id>` activation. The single-instance desktop shell receives
that activation, confirms the approved job with the local control service,
stops the runtime through its existing lifecycle owner, launches the staged
candidate executor, and exits. No Tauri command is exposed to loopback Web
content.

### Restart verifier

The candidate executor stays alive across the old shell exit. After activation
it launches the stable desktop entry with `--resume-update <job-id>`, waits for
the gateway, and checks the active release ID. The new runtime resumes the same
persisted job, runs bounded acceptance, and marks it successful. The Agent reads
that terminal result after its session reconnects and reports completion.

If the shell or runtime does not become healthy before the deadline, the
executor invokes the existing rollback path, restores `previous`, relaunches the
stable entry, verifies the old release, and records `rolled_back` with a redacted
reason. Rollback never downloads another artifact.

## Update job state machine

Jobs live under `workspace/runtime/updates/<job-id>/job.json` with mode `0600`
where supported. Writes are atomic and every transition is appended to the
redacted operation audit.

```text
available
  -> planned
  -> approved
  -> downloading
  -> verified
  -> waiting_for_safe_window
  -> draining
  -> activating
  -> restarting
  -> verifying
  -> succeeded

Any state before activating -> failed (current is unchanged)
activating/restarting/verifying -> rolling_back -> rolled_back
```

The record includes only version metadata, channel, platform, expected digest,
operation ID and digest, timestamps, retry count, previous/current release IDs,
and redacted failure data. It does not contain release signing keys, HTTP auth,
Workspace content, prompts, or raw process logs.

An interrupted executor resumes from the persisted state. Activation is
idempotent by release ID. If `current` already names the verified candidate, the
executor continues at restart verification; it does not install a second time.

## Safe restart and Agent delegation

The Agent may always perform these non-mutating actions:

- check the configured release channel;
- compare current and available versions;
- read release notes and compatibility metadata;
- create a plan with download size, expected downtime, active-work summary, and
  rollback target;
- choose or wait for a safe window;
- resume the update story after restart and report the verified outcome.

Before restart, the coordinator stops accepting new Agent work, waits for active
main/Worker sessions to reach a persisted checkpoint, flushes Activity and audit
writes, and pauses channel intake with a bounded timeout. It must not claim that
arbitrary in-flight external side effects can be rolled back. If the safe window
deadline expires, the update remains `waiting_for_safe_window` unless the user
approved an explicit force-now plan.

Apply and rollback are R3 because they stop the local Agent and replace executable
code. V1 uses the existing digest-bound local approval for each action. An Agent
can therefore be told “检查并更新”，perform all preparation, present the exact
plan, wait for one confirmation, and finish the restart/verification without
further manual steps.

Standing delegation is a follow-up capability, not part of V1. Its policy is
stored as a signed/digested local operation grant with all of these mandatory
bounds:

- stable channel only;
- product-signed, platform-signed, non-downgrade releases only;
- a user-selected maintenance window;
- no active non-checkpointed task and no pending R2/R3 operation;
- maximum expected downtime and download size;
- automatic rollback on failed acceptance;
- automatic expiry and a local-console revoke action.

Creating, widening, renewing, or disabling automatic rollback for that policy
requires fresh authenticated local approval. A Worker, Personal App, Extension,
remote browser, or channel message can request a check but cannot create or
widen the delegation.

## Stable command contract

The target CLI surface is:

```text
personal-agent update check --json
personal-agent update plan [--version <version>] [--window <time>] --json
personal-agent update apply --operation <id> --digest <digest> --json
personal-agent update status [--job <id>] --json
personal-agent update rollback --operation <id> --digest <digest> --json
```

`check`, `plan`, and `status` are R0. `apply` and `rollback` are R3. Commands use
the local control service and never accept arbitrary URLs or filesystem paths.
The existing registry entry that groups all update verbs as R3 must be split
when implementation starts.

The bootstrap-only pre-release surface is intentionally on the self-contained
updater rather than the already-installed older runtime:

```text
personal-agent-setup candidate-plan --expected-revision <40-hex-commit>
personal-agent operation approve <operation-id> --digest <digest> --json
personal-agent-setup candidate-apply --operation <operation-id> --digest <digest>
```

The normal flow uses the middle command and its authenticated interactive local
TTY challenge. A registered product-development delivery instead uses
`candidate-plan --authorized-product-delivery`; this records an owner-delegated
approval scoped to the exact candidate digest and removes the redundant second
prompt. The candidate executable never accepts a raw release directory, URL, or
install root.

## Console experience

System Settings gains one focused client-update section showing current version,
channel, last successful check, available version, download size, restart impact,
and the latest job state. Its actions are “检查更新”, “查看更新计划”, “更新并重启”,
and, only after a failed candidate, “恢复上一版本”.

The Console may create and approve a local operation but cannot call a native
Tauri updater API. During the handoff it shows “正在安装，客户端将自动重启”. After
restart, the same route reads the persisted job and shows success or automatic
rollback. This is a material product flow and requires an approved desktop
prototype before UI implementation.

Mobile remains read-only for client updates. It may show “客户端正在更新” and
temporary unavailability, but it cannot approve, apply, or roll back executable
code remotely.

## Acceptance gates

Implementation is not complete until CI and fresh-machine acceptance cover:

- valid signed update for every supported OS/architecture;
- invalid product signature, checksum, size, schema, target, and downgrade;
- interrupted download and resumable clean retry;
- active-task safe-window deferral and explicit force-now behavior;
- candidate preactivation failure with unchanged `current`;
- process termination or power-loss simulation before and after pointer switch;
- shell exit, runtime stop, candidate activation, automatic shell relaunch, and
  post-restart Agent continuation;
- readiness timeout followed by automatic previous-release rollback and relaunch;
- Workspace and Personal App preservation across update and rollback;
- updater self-update on Windows without replacing a running executable;
- denial for remote sessions, Workers, Apps, Extensions, raw URLs, expired plans,
  changed digests, replayed approvals, and forged shell handoffs;
- sanitized audit evidence with no credentials, customer content, or private
  filesystem details;
- local-only rollback while the network is unavailable.

## Delivery sequence

1. Publish and verify the signed static release index and platform artifact
   metadata without changing installation behavior.
2. Add read-only `update check`, `update plan`, and `update status` contracts,
   schemas, registries, fixtures, and tests.
3. Add persisted update jobs and candidate download/verification without
   activation.
4. Add the shell handoff, external executor, restart verifier, and automatic
   rollback behind local acceptance builds.
5. Add the approved System Settings flow and Agent Skill command map.
6. Run previous-to-candidate upgrade, failure rollback, fresh-clone, public
   surface, packaging, platform-signing, provenance, and customer-machine
   acceptance before enabling stable-channel updates.
7. Consider standing delegation only after V1 one-shot updates have production
   evidence.

## Consequences

- ADR 0005 remains correct that the Tauri shell does not become an updater. This
  proposal gives it only a narrow, authenticated lifecycle handoff to the native
  product updater.
- The native installer stays the single release root of trust and activation
  implementation.
- Owner-delegated product delivery removes redundant confirmation while retaining
  an exact revision, digest, expiry, installed-state fingerprint, and audit trail.
- Update success is reported only after the new release has restarted and passed
  acceptance; “installer exited successfully” is not sufficient evidence.
