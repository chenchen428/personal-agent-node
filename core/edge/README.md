# Private Site Edge

This project is the reusable user-owned ECS traffic boundary for a complete private
Site. It owns public TLS, ACME, fixed-host routing, WireGuard origin transport,
and origin mTLS. It does not own channel credentials, messages, files, sessions,
or application databases.

The product-level custom-domain SOP uses `self-hosted-relay.mjs` instead of the
legacy network tunnel. The Relay authenticates one outbound Node connection with
a random bearer key (only its SHA-256 digest is stored on the server), reuses the
`pa-reverse-ws-v1` application protocol, and needs no WireGuard, fixed tunnel IP,
customer-machine administrator rights, or platform quota. The low-level Edge
registry and WireGuard tooling below remain for explicit legacy migration.

For custom-domain mail, a user-managed Postfix instance may use
`install-self-hosted-mail.sh`. It accepts only the exact configured recipients
and posts raw RFC 5322 messages to a loopback-only Relay endpoint. The Relay
routes mail by recipient domain to the corresponding Space and the local Agent
archives it through its existing authenticated import API. Nginx returns 404 for
the internal ingest path; SMTP queues and policy remain owned by Postfix, and no
SMTP/IMAP server is included in Node.

The `sites.json` file registers the complete Site for the owner's apex domain. The
renderer expands the shared distribution in registry/site-distribution.json;
operators do not configure ad hoc sub-sites.

There is no hosted Control API or invitation system. The clone-based bootstrap
uses the owner's ECS SSH credential to install the Edge, sign the Node CSR, write
or atomically update only its route record, and apply configuration. Existing
unrelated Site records are preserved. Repeated bootstrap reuses the same private
address, while a domain, Site, or Node identity conflict fails closed. The Edge never receives a Node private
key or business data.

Production paths:

- /etc/private-site-edge/sites.json: non-secret route records
- /etc/private-site-edge/nginx: generated Nginx includes
- /etc/private-site-edge/certs: installed public certificates
- /etc/private-site-edge/pki: Edge client identity and origin CA
- /var/lib/private-site-edge: bounded operational state
- /var/log/private-site-edge/traffic-<site>-<node>.log: payload-free operational metrics

Self-hosted workflow from the repository root:

```bash
node scripts/bootstrap-private-site.mjs plan --config secrets/bootstrap.json
node scripts/bootstrap-private-site.mjs apply --config secrets/bootstrap.json
node scripts/bootstrap-private-site.mjs verify --config secrets/bootstrap.json
```

The bootstrap config contains only non-secret values and paths to ignored local
credential files. It configures apex and wildcard `A` records through AliDNS,
opens the bounded ECS security-group ports, and issues the Site certificate after
the local WireGuard and origin identities are ready.

Use scripts/reconcile-certificates.sh on ECS for initial issuance and daily
renewal. http-san uses HTTP-01 and needs no customer DNS API credential.
dns-wildcard is retained for the current Aliyun-managed domain.

The Edge metric log contains only timestamp, opaque Site and Node IDs, normalized
domain, HTTP outcome, byte counts, and request duration. It contains no source IP,
method, path, query, header, cookie, or body. Logrotate retains seven daily files;
`private-site-edge status` returns aggregate counts rather than raw lines.

To disable or revoke a Site through the bounded registry contract:

```bash
node bin/private-site-edge.mjs site-status example.site revoked
bash ../../infra/edge/apply-config.sh
```

Bootstrap uses these bounded registry commands internally:

```bash
node bin/private-site-edge.mjs site-plan SITE_ID NODE_ID example.site
node bin/private-site-edge.mjs site-upsert /path/to/non-secret-site-record.json
```

`site-plan` allocates or reuses a WireGuard address without writing. `site-upsert`
uses a lock and atomic replacement, preserves other Sites, and rejects silent
identity takeover.

Replacement restores use the separate `site-replacement-plan` and `site-replace`
commands. They require the previous Node ID recorded by `restore-apply`, preserve
the Site/domain/address, atomically archive the old public peer record, and are
idempotent after an interrupted bootstrap. Ordinary upsert never performs this
identity change.

`site-status` updates only `sites.json`. Apply immediately afterward so Nginx and
WireGuard atomically remove the public route and peer. The revoked Site remains
locally usable.
