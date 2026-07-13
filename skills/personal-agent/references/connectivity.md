# Connectivity

Choose one declared mode with `connection set`: `local-only`, `managed-cloud`, or `self-hosted-edge`.

Local-only is the default complete product path. It must support the local console, Agent, BYOK, channels, files, automation, publications and backup without Cloud.

Managed Cloud enrollment uses `cloud enroll`; inspect the plan, invitation scope and data disclosure before requesting approval. Disconnecting Cloud must not delete local data.

Self-hosted Edge uses `edge plan`, `apply`, `verify` and `rollback`. Edge is a transport plane and must not receive conversation content, credentials, private files, databases, or internal service topology.
