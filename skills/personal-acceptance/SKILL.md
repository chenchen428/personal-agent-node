---
name: personal-acceptance
description: Apply the portable customer-machine acceptance standard for Personal Agent Node. Use for milestone, release, final delivery, installation, upgrade, rollback, Console, CLI, permission, connection, Pages, task, or optional Managed Cloud acceptance decisions.
---

# Personal Acceptance

Apply evidence-based gates. Distinguish Node Core from optional Managed Cloud integration, and fail closed when required evidence is missing.

For release/final acceptance, install the exact public GitHub Release asset. Use authenticated local `/app/chat`, send a unique prompt to the real Agent runtime, and observe the Agent reply in that same session. Record `wechatRequired=false`; WeChat is optional evidence and never blocks core acceptance.

Keep secrets and customer content out of evidence. Require exact artifact identity, checksums, runtime status, route behavior, update/rollback state, and the declared customer-machine contract.

Read [acceptance.md](references/acceptance.md) and apply only the gate appropriate to the requested acceptance level.
