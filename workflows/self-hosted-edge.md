# Self-hosted Edge

The product custom-domain path is a user-owned, single-key `pa-reverse-ws-v1`
Relay. The Console asks for the normalized domain and the one-time key displayed
by a fresh Relay install, projects the apex and one subdomain per Space, and waits
for the user to finish server and DNS preparation before it detects the result.
Server addresses, SSH users and private-key paths are not product form inputs.

Every GitHub Release publishes one version-bound `personal-agent-relay-install.sh`
asset. It is covered by the release `SHA256SUMS`, Sigstore bundles and provenance,
and embeds the same release's bundled Relay so the server never follows mutable
source branches. The Console shows the exact asset URL for its installed version:

```bash
curl -fL 'https://github.com/chenchen428/personal-agent-node/releases/download/vX.Y.Z/personal-agent-relay-install.sh' -o /tmp/personal-agent-relay-install.sh
sudo bash /tmp/personal-agent-relay-install.sh example.com
```

The self-extracting asset invokes `infra/edge/install-self-hosted-relay.sh` with
the bundled `self-hosted-relay.mjs` on the user's Linux server. A fresh install generates a random connection key,
shows it once on the server terminal, and stores only its digest. The user pastes
that key into the Personal Agent client, which keeps it in the local Workspace.
The Relay terminates public HTTP/TLS through Nginx, accepts one outbound Node connection, and
does not require WireGuard, a fixed private address, local administrator rights
on the Node, or a platform quota.

The outbound connector uses `wss://<domain>/v1/connect` on the same apex domain
as the public entry. This avoids a second connector-only DNS dependency; existing
`wss://connect.<domain>/v1/connect` bindings are upgraded in memory when loaded.

Repeated installation preserves the existing key digest. Use the explicit
`--rotate-token` third argument only when the client key will be replaced at the
same time. Fresh install and rotation require an interactive terminal so the
one-time plaintext key is not written into unattended automation logs.

Custom-domain mail remains user managed. The optional
`infra/edge/install-self-hosted-mail.sh` configures Postfix with an exact
recipient allowlist and pipes each RFC 5322 message into the Relay's loopback-only
mail endpoint. The Relay sends it over the existing authenticated connection to
the matching Space, whose local Agent performs the ordinary mail import. The
public Nginx route rejects this internal endpoint, and Node still bundles no SMTP
or IMAP server.

Legacy WireGuard/ACME/Nginx Edge tooling remains only for explicit low-level
migration. Never upload Node credentials, Agent state, model requests, mailbox
credentials, or persisted message data to the Relay.
