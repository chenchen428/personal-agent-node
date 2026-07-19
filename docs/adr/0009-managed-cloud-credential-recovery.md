# ADR 0009: Managed Cloud credentials rotate and fail into visible reauthorization

Status: proposed
Date: 2026-07-19

## Context

The reverse tunnel previously used one durable bearer credential. A revoked or drifted credential made the Broker return HTTP 401, while the Connector retried indefinitely and resource registration could still make Setup Center look complete. Background authorization may reuse only an authenticated first-party browser session and a purpose-bound one-time request; it must never give the Agent access to cookies, passwords, or session storage, and it must stop at any interactive login, MFA, risk, denial, or provider failure.

## Decision

Managed Cloud enrollment issues a 15-minute access token and a 30-day rotating refresh token. Only hashes are stored by Cloud. The refresh token is bound to the exact Site, installation id, and Space id; it is single-use and every successful refresh replaces both tokens in one local secret-file write. Access and refresh tokens never appear in URLs, runtime state, audit metadata, CLI arguments, or browser progress events.

The Connector uses this state machine:

| State | Trigger | Action | Exit |
| --- | --- | --- | --- |
| `healthy` | Tunnel ready and heartbeat fresh | Proactively refresh before access expiry | `refreshing` |
| `refreshing` | Expiry window or Broker 401 | Single-flight refresh; no browser | `healthy`/`recovered`, `degraded`, or `authorizing` |
| `degraded` | Network/Cloud unavailable | Mark public access offline and retry with bounded exponential backoff | `refreshing`, `recovered`, or `failed` |
| `authorizing` | Refresh is terminal but the enrolled device proof is available | Start a single-flight `prompt=none` transaction, open the official page, and accept only a loopback authorization code | `recovered` or `reauth_required` |
| `reauth_required` | Browser session/consent is absent, MFA or risk interaction is required, the browser is unavailable, or proof validation fails | Stop the retry storm and expose the governed managed-authorize action | `authorizing` after a person starts visible authorization |
| `recovered` | Credential replacement succeeded | Reconnect, require ready plus fresh pong, then verify public HTTPS | `healthy` |
| `failed` | Authorization denied/expired or recovery remains unavailable | Preserve local-only functionality and an actionable status | `authorizing` or `degraded` |

Setup Center is complete only when registration, resources, tunnel readiness, and heartbeat freshness are all true. A 401 immediately records `degraded`, then either refreshes or records `reauth_required`; it can no longer remain visually OK because a domain is registered.

## Threat model and controls

- **Token theft:** access tokens are short-lived and least-purpose (Node heartbeat/tunnel only); refresh tokens remain in the mode-600 secrets file and are hash-only server-side. Logs and public status contain codes and expiry times, never credentials.
- **CSRF and substituted authorization:** enrollment keeps the existing same-origin POST, OAuth state and PKCE, purpose-bound device code, and one-time enrollment credential. The official page may submit that POST automatically only after validating the first-party session and exact one-time request; Node never receives the session Cookie.
- **Silent browser bootstrap:** installation-initiated enrollment creates an Ed25519 device proof key and records the exact Site/account/installation/Space binding. For initial connection or terminal refresh, Node binds a two-minute transaction to state, nonce, PKCE S256, a random loopback callback, tenant, and device proof. The browser contributes only its same-site HttpOnly session Cookie; Node and Agent never read browser storage. Cloud returns only a one-minute, single-use code to loopback, never a token in a URL.
- **Interaction boundary:** silent success is allowed only for a valid existing account session and an exact unexpired one-time Node request when no MFA, reauthentication, or risk interaction is required. `login_required`, `interaction_required`, MFA, risk denial, timeout, and browser failure all become visible `reauth_required`; after that failure, only the visible recovery action may retry.
- **Device substitution:** refresh and silent bootstrap check Site, tenant account through the Site, installation id, Space id, the Site's enrolled device id, and a signed proof from the enrolled Ed25519 key.
- **Replay and theft detection:** consuming a refresh token is atomic. Reuse or binding mismatch revokes the token family, clears the active access hash, closes the tunnel, and creates a redacted audit event.
- **Concurrent refresh:** Node single-flights refresh. Cloud serializes rotation with `BEGIN IMMEDIATE`; a second consumer is treated as replay and fails closed.
- **Authorization-code and callback replay:** authorization codes and device-proof JTIs are single-use and short-lived. Redirects are restricted to `http://127.0.0.1:<ephemeral>/callback/<random>`, and the listener requires the exact Host, path, and state before exchange.
- **Revocation:** administrator Site revocation clears the access credential and revokes all active refresh credentials. Browser re-enrollment cannot reactivate an administratively revoked Site.
- **Timeout and outage:** network failures do not delete the last local configuration. Retries are exponential and bounded; terminal authorization failures stop retries and preserve local mode.
- **Downgrade and confused origin:** refresh endpoints must be the exact selected Cloud origin, HTTPS except explicit loopback tests, with no credentials, query, or fragment.

## Compatibility and rollout

Existing nullable access-expiry rows remain valid until a new enrollment, which allows a staged Cloud-first rollout. New enrollment requires the rotation contract. Production rollout is R3 for Cloud and R2 for Node update, requires governed plan/approval, and must verify refresh, tunnel ready, fresh heartbeat, public HTTPS, replay rejection, and rollback before acceptance. No production deployment is performed by this source change.
