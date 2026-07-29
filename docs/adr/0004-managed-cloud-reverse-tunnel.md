# ADR 0004: Managed Cloud uses an application reverse tunnel

Status: accepted  
Date: 2026-07-15

## Context

Personal Agent Node needs to receive HTTP, streaming, and WebSocket requests forwarded by an optional managed ECS service. It does not need to join the Cloud private network or proxy unrelated customer-machine traffic.

The previous managed enrollment allocated a WireGuard address and activated `wg-quick` on the customer machine. That introduced administrator privileges, platform prerequisites, tunnel interfaces, routes, and possible DNS interaction for an application forwarding problem.

Self-hosted custom domains remain an independent provider and now reuse the same application-layer reverse WebSocket protocol with a user-owned, single-key Relay. Legacy WireGuard tooling remains available only for explicit low-level Edge migration and is not part of the custom-domain SOP.

## Decision

Managed Cloud uses `pa-reverse-ws-v1`:

1. Node opens one authenticated outbound WSS connection to the endpoint returned by enrollment.
2. Cloud multiplexes allowed HTTP and WebSocket streams over that connection.
3. Node forwards streams only to the fixed local gateway at `127.0.0.1:8843`.
4. Node delegates safe HTTP and WebSocket paths to the fixed local gateway. The gateway applies one access rule: direct loopback requests bypass login; tunneled requests bypass login only when their route is on the explicit public whitelist, and every other path requires the host-scoped access session before normal route resolution continues.
5. Connector state is runtime metadata under Workspace. The Node Token remains only in the mode-600 secret environment file.
6. The Connector runs as a child of the existing Personal Agent supervisor. It does not install a network service.
7. Local-only mode starts no Connector and makes no Cloud request.

Managed enrollment must not generate WireGuard keys, install WireGuard, execute privileged commands, or modify the customer machine's proxy, DNS, routes, firewall, hosts, or network interfaces.

## Consequences

- Managed remote access no longer needs administrator privileges or WireGuard tools.
- The authenticated desktop Web Console and mobile surface are both available through the managed tunnel; public routes remain the only unauthenticated exception.
- HTTP streaming, WebSocket boundaries, backpressure, cancellation, heartbeats, reconnects, and resource limits become explicit application protocol responsibilities.
- Cloud must terminate public TLS and operate a compatible Tunnel Broker.
- Setup readiness uses Connector `ready` state and a fresh pong instead of interface or peer state.
- Existing low-level Edge and WireGuard commands remain available for legacy migration, while the product custom-domain path uses the self-hosted WSS Relay.
