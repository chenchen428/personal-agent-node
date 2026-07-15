# Personal Agent Customer Workspace

This workspace belongs to its user. Treat all files, databases, mail, logs,
plugins, publications, and generated content as private local data.

- Read `registry/skills.json`, `registry/plugins.json`, and the relevant workflow
  before changing a capability.
- Keep credentials under `secrets/`; never print them into chat, logs, or reports.
- Install plugins only through the governed Personal Agent operation flow.
- Do not edit files below `../core/current`; core upgrades replace them.
- Preserve user files and databases during upgrade, rollback, and uninstall.
