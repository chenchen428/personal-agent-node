# ADR 0008: Browser-executed social reading capabilities

- Status: Accepted
- Date: 2026-07-18
- Scope: Personal Agent Node CLI, browser execution, Xiaohongshu, and Twitter/X reading
- Related: ADR 0002 Self-contained installation, ADR 0003 Core/workspace architecture, ADR 0006 Local Personal Apps

## Summary

The product presents Xiaohongshu and Twitter/X as Connections because users need
to understand which platforms Personal Agent can access. In the domain model
they are `browser` connections, not credential-bearing `account` connections.
Personal Agent drives the user's existing, visible browser through a bounded
provider, but it does not establish, import, export, persist, poll, or report the
platform login session.

The stable product surface is `pa-cli connection <platform> ...` because
Connections is the capability catalog. The `social-browser-read` Skill owns the
safe search-and-read workflow behind both entries, while the connection owns
platform discovery, availability status, and CLI routing. OpenCLI or Ego is an
executor behind that boundary, not a product connection or Skill.

V1 uses OpenCLI as the browser executor. It exposes only executor status, opening
a fixed platform page, search, and content reading. OpenCLI's post, reply, like,
follow, bookmark, direct-message, cookie, arbitrary browser, JavaScript, and CDP
surfaces are not exposed.

The pinned OpenCLI runtime is part of the immutable Personal Agent release. It
uses the Node.js runtime already carried by each platform installer and is never
a customer-installed global command. The official Browser Bridge remains a
separate Chrome permission that the user must explicitly confirm.

## Decision drivers

1. The user's browser remains the sole owner of cookies, login state, CAPTCHA,
   SMS, QR, 2FA, SSO, and account recovery.
2. Personal Agent must not turn browser reuse into a second credential store or
   a misleading connected/disconnected account state.
3. The CLI and local API need stable, normalized read contracts even when the
   underlying browser tool or page structure changes.
4. A reusable browser executor should make additional platforms cheaper without
   becoming a generic shell or browser-automation proxy.
5. Existing managed Xiaohongshu channel callers need a bounded compatibility
   path while the public Connections and Skill surfaces move to browser reading.
6. A self-contained installation must not ask customers to install Node.js, npm,
   OpenCLI, or a globally discoverable command.

## Architecture

```text
pa-cli / local Connections API
              |
              v
social-browser-read Skill policy
              |
              v
platform read provider
  - fixed operations and URLs
  - input validation
  - rate spacing
  - output normalization
              |
              v
bounded browser executor (OpenCLI V1, Ego candidate)
              |
              v
user-owned visible browser and account session
```

`registry/connections.json` classifies entries as `account`, `browser`, or
`local`. This allows one product catalog without pretending every connection
has the same authorization lifecycle.

The reusable OpenCLI runner owns process limits, a minimal child environment,
output size limits, timeouts, JSON parsing, stable exit-code mapping, and
redacted errors. Platform providers own exact command allowlists, URL validation,
rate spacing, and result normalization. Runtime callers cannot pass raw OpenCLI
arguments.

## Public contract

```text
pa-cli connection xiaohongshu status
pa-cli connection xiaohongshu open
pa-cli connection xiaohongshu search --keyword <query>
pa-cli connection xiaohongshu read --url <signed-xiaohongshu-url>
pa-cli connection xiaohongshu read --feed-id <id> --xsec-token <token>

pa-cli connection twitter status
pa-cli connection twitter open
pa-cli connection twitter search --query <query>
pa-cli connection twitter read --tweet-id <id>
pa-cli connection twitter read --url <x-status-url>
```

`status` checks only the OpenCLI executable, local daemon, and official Browser
Bridge extension. It never runs `auth status`, reads cookies, navigates to a
profile, or reports `loggedIn`.

`open` opens one fixed platform home page in the user browser. It returns
`connectionCreated: false`; it does not create or poll a login session. If the
page needs authentication, CAPTCHA, QR, SMS, or 2FA, the user handles that in the
browser and reruns the read operation.

`search` and `read` are external reads. An upstream authentication error is a
typed blocker and a request for user browser interaction, not evidence that
Personal Agent owns a disconnected account.

## Status model

Browser connections use these availability states:

- `ready`: the bundled browser executor is valid and either ready or idle, displayed
  as “浏览器可用”;
- `needs_setup`: Chrome still needs the user's Browser Bridge permission;
- `error`: the bundled executor is missing, damaged, unsupported, or violated
  the expected status or output contract.

For `needs_setup`, the Connection UI shows one fixed Chrome Web Store handoff and
a retry check. It never shows npm commands, asks the customer to install a CLI,
silently enables browser permissions, or requests platform credentials.

Responses include `browserOwnedSession: true` and
`loginStateInspected: false`. They do not include `loggedIn`, a platform account
identity, cookie names, profile data, or authentication timestamps.

An idle OpenCLI daemon does not make the capability disconnected. It may start
lazily on the first browser operation. If the daemon is running and reports a
missing or ambiguous Browser Bridge profile, status is `needs_setup`.

## OpenCLI allowlist

The providers may invoke only these command shapes:

```text
opencli --version
opencli daemon status
opencli browser <generated-session> open https://www.xiaohongshu.com/
opencli browser <generated-session> open https://x.com/home
opencli xiaohongshu search <bounded-query> --limit 20 --format json
opencli xiaohongshu note <validated-signed-url> --format json
opencli twitter search <bounded-query> --limit 20 --format json
opencli twitter thread <validated-id-or-status-url> --limit 50 --format json
```

The generated browser session name is an operational tab lease, not a login
session and not a credential. It is not persisted or polled.

Xiaohongshu note URLs must use HTTPS, an allowlisted Xiaohongshu host, a
supported note path, and a bounded `xsec_token`. Twitter status URLs must use
HTTPS on `x.com` or `twitter.com`, match one status path, and contain a bounded
numeric tweet id. Search text remains one process argument and is never
interpreted by a shell.

## Credential and process boundary

Personal Agent never requests, displays, logs, persists, imports, exports, or
syncs browser cookies. Child processes receive a minimal environment that omits
Personal Agent API tokens, passwords, Cloud credentials, GitHub tokens, and
unrelated application secrets. OpenCLI runs without a shell, with bounded
arguments, timeouts, stdout, and stderr.

Raw OpenCLI stderr is not returned because it may include profile paths or page
data. Stable exit codes and allowlisted upstream codes map to redacted typed
errors for missing setup, authentication required, browser unavailable, timeout,
empty result, platform security block, invalid configuration, or contract
failure.

OpenCLI requires its runtime, local daemon, and official Chrome Browser Bridge
extension. Personal Agent bundles the runtime and daemon implementation inside
the release, while Chrome retains the extension permission decision. Personal
Agent detects the missing permission and opens only the fixed official store
listing; it never enables browser permissions silently.

## Distribution and updates

Release assembly installs `@jackwener/opencli@1.8.6` from its committed npm lock
with lifecycle scripts disabled. The complete production dependency graph,
upstream license, release checksums, and CycloneDX components ship with the Node
artifact. Platform installers copy that immutable release and perform no npm or
OpenCLI network installation on the customer machine.

The runtime resolver uses an explicit development override first, the current
release's bundled entrypoint second, and an existing global command only as a
legacy compatibility fallback. Bundled execution redirects OpenCLI's mutable
home and cache beneath the user-owned Personal Agent workspace. Runtime upgrades
therefore follow Personal Agent release, upgrade, and rollback atomically.

## Browser backends evaluated

Ego Lite and `oil-oil/video-publisher-skill` validate the value of a visible,
user-owned browser with isolated task Spaces. Their strongest reusable patterns
are stable Space identity, stopping when the user takes control, fresh page
inspection before trusting saved state, typed blockers, and independent
verification instead of treating an attempted click as success.

Ego Lite is not the V1 backend because the evaluated release offers a Mac
download while Windows is waitlisted, and `ego-browser` accepts a complete
Node.js program with page JavaScript and raw CDP helpers on stdin. Exposing that
surface would violate this ADR's narrow operation boundary.

The architecture leaves room for an `ego` provider that runs checked-in,
reviewed platform adapters only. Callers may choose a supported operation and
validated inputs, but may not supply JavaScript, selectors, coordinates, CDP
commands, or arbitrary URLs. Such a provider must preserve stable Space
identity, stop on user takeover, and return data only after fresh read-only
verification.

`video-publisher-skill` itself is not imported. It targets creator-page draft
mutation and publishing safety, while this contract is strictly read-only.

## Compatibility

The old managed Xiaohongshu channel implementation and `/api/channels`
authentication routes remain temporarily available for historical callers.
They are not used by the current Xiaohongshu Connection, generated connection
guide, or current UI, and `/agent-channels` redirects to the browser Connection.

The deprecated `pa-cli connection xiaohongshu connect` spelling aliases `open`
and returns `connectionCreated: false`; it never starts QR authentication. The
older `pa-cli channel login xiaohongshu` namespace retains its historical
managed behavior until a separate compatibility-removal decision.

Existing Xiaohongshu `feed-id` plus `xsec-token` reads remain accepted. Search
results preserve those fields and also return the full signed URL. Added Twitter
commands and response fields are additive.

## Reliability

Both providers serialize reads with bounded spacing. They do not retry CAPTCHA,
login challenges, security blocks, or rate limits. Page or GraphQL changes fail
closed when required fields or output shape are missing.

The managed historical service may continue to run even though the current
Connections surface uses OpenCLI. Removing that service from installation and
lifecycle management requires release migration evidence and is outside this
change.

## Acceptance gates

- Status invokes no platform authentication or cookie inspection command.
- Status never returns `loggedIn` or an account identity.
- `open` uses only a fixed platform home URL and creates no connection record.
- OpenCLI execution is shell-free, bounded, and excludes unrelated secrets.
- Platform artifacts contain the pinned OpenCLI runtime and license, and the
  release SBOM records its locked production dependency graph.
- Customer installation performs no npm install and requires no global OpenCLI.
- The Connection UI contains no npm command or third-party CLI installation
  instruction; Browser Bridge activation remains an explicit Chrome decision.
- Search and read commands are fixed and their inputs are validated.
- Only signed Xiaohongshu note URLs and valid Twitter status targets are read.
- OpenCLI results preserve normalized, backward-compatible Xiaohongshu fields.
- Twitter results normalize text, identity, engagement, URL, and HTTPS media.
- Current Connections UI contains no Xiaohongshu QR or login-state flow.
- Xiaohongshu and Twitter/X are cataloged as `browser` connections and identify
  `social-browser-read` as their workflow Skill.
- Historical channel APIs and CLI namespace continue to pass their existing
  compatibility tests without appearing in the current capability contract.
