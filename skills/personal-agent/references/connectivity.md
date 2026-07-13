# Connectivity

Choose one declared mode with `connection set`: `local-only`, `managed-cloud`, or `self-hosted-edge`.

Local-only is the default complete product path. It must support the local console, Agent, BYOK, channels, files, automation, publications and backup without Cloud.

Managed Cloud enrollment uses `personal-agent cloud connect --json`. The CLI requests a short-lived device code, opens the same-origin Cloud verification page, prints only the verification URL and user code, and polls until the signed-in account confirms its assigned Site. It then consumes a one-time enrollment credential and stores the long-lived Node token only in the mode-600 local secret file. Never echo or persist the device code, enrollment credential, Node token, or generated local password in Agent output. If the browser cannot open, give the user `verificationUrlComplete`; expiry, denial, or a different pending Cloud must fail closed and require a safe retry. Disconnecting Cloud must not delete local data.

Self-hosted Edge uses `edge plan`, `apply`, `verify` and `rollback`. Edge is a transport plane and must not receive conversation content, credentials, private files, databases, or internal service topology.
