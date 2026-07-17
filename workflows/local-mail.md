# Local Mail Ingress

Personal Agent does not bundle an SMTP or IMAP server. A user-managed local MTA receives and validates mail, then pipes one complete RFC 5322 message to `pa-cli mail ingest`. The command follows the active immutable Node release, archives the EML under `PRIVATE_SITE_DATA_ROOT/mail`, and submits a token-authenticated event to the loopback Agent service.

The mailbox service belongs to the user's own Node. The user may keep it LAN-only or expose SMTP/IMAP with a separately reviewed protocol-aware tunnel or relay. Managed Personal Agent Cloud and HTTP path routing do not receive mail bodies, attachments, mailbox credentials, queues or DKIM private keys.

## Boundary

- The local MTA owns SMTP listening, recipient allowlists, queueing, retries, STARTTLS, SPF, DKIM, DMARC and spam filtering.
- Personal Agent owns local EML archival, retention, automation, encrypted backup and the authenticated `/app/mail` reader.
- `/app/mail` may be exposed through the existing HTTPS tunnel.
- SMTP and IMAP are not HTTP and cannot be mounted below a URL path. A public mail transport requires a reviewed protocol-aware relay or a user-operated public endpoint.
- Personal Agent does not open public TCP port 25 by default.

Treat every message and attachment as untrusted input. The trusted MTA must remove externally supplied `Authentication-Results` headers and add its own verified result before invoking the pipe. Do not place the ingest token in Postfix configuration or command arguments; the installed shim reads it from the mode-`0600` Site environment file.

## Plan

1. Install and prepare a verified Personal Agent Node release.
2. Run `personal-agent mail plan --preview --json` and review the suggested recipient names and pipe contract. The suggestions do not prove or configure the MTA allowlist.
3. Configure the local MTA with a strict recipient allowlist and a dedicated pipe transport running as the Personal Agent operating-system user.
4. Start with loopback or private-tunnel delivery. Do not bind an unauthenticated SMTP listener to a LAN or public interface.
5. Deliver a test EML and run `personal-agent mail status --json`.
6. Sign in locally and verify the message, raw EML and attachments at `/app/mail`.
7. Create and verify an encrypted backup before changing retention or public transport.

Release installation and activation generate a missing ingest token inside the existing mode-`0600` Site environment and then render the stable shim. Upgrade preparation copies legacy `mail-ingress/` and `channels/mail/` content into `mail/` only after a conflict-free preflight, never deletes the legacy source, and is safe to repeat. `mail status` and `doctor` are read-only and never generate, migrate or rewrite state. Normal encrypted backups include `PRIVATE_SITE_DATA_ROOT/mail`; restore acceptance must compare a local fixture EML without publishing its recipient, body, attachment or token.

The non-secret Postfix shape is tracked in [`examples/postfix-personal-agent.pipe.example`](examples/postfix-personal-agent.pipe.example). Replace every angle-bracket placeholder locally. Never commit generated MTA configuration, usernames, domains, paths or credentials.

The pipe returns exit code `0` after durable local archive and event acceptance. Exit code `75` is a temporary failure; the MTA must retain the message and retry. Do not configure the MTA to discard a message after a temporary failure.
