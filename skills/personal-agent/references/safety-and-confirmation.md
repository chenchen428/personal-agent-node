# Safety And Confirmation

- R0 is local read-only and can run directly.
- R1 is a reversible local write; report the resulting change. `--yes` is limited to R1.
- R2 is an external write or sensitive configuration change.
- R3 is destructive, recovery-related, or infrastructure work.

For R2 and R3, create a plan that returns an operation ID, impact summary, expiry and confirmation digest. The user approves that exact digest through the authenticated local console or an interactive local TTY. Then execute the approved operation and verify it.

Plans expire after ten minutes and become invalid when inputs, targets, or relevant state change. Agents, background jobs, remote HTTP clients, and Extensions cannot approve their own operations. Retries carry an idempotency key. Audit evidence records actor, operation ID, input summary, target, result and redacted external reference.
