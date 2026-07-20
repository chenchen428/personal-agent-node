# Self-hosted Edge

The product custom-domain path is a user-owned, single-key `pa-reverse-ws-v1`
Relay. The Console asks only for the domain, projects the apex and one subdomain
per Space, and waits for the user to finish server and DNS preparation before it
detects the result. Server addresses, SSH users and private-key paths are not
product form inputs.

Install `self-hosted-relay.mjs` with `infra/edge/install-self-hosted-relay.sh`
on the user's Linux server. The Relay terminates public HTTP/TLS through Nginx,
accepts one outbound Node connection, and stores only the Relay key digest. It
does not require WireGuard, a fixed private address, local administrator rights
on the Node, or a platform quota.

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
