# Personal Agent Customer Workspace

This workspace belongs to its user. Treat all Apps, files, databases, mail,
logs, plugins, publications, and generated content as private local data.

- Read `registry/skills.json`, `registry/plugins.json`, and the relevant workflow
  before changing a capability.
- Keep credentials under `secrets/`; never print them into chat, logs, or reports.
- Install plugins only through the governed Personal Agent operation flow.
- Create trusted local Personal Apps only under `apps/<app-id>`. Keep App source,
  build output, and App-owned data inside that directory, and run
  `personal-agent app verify <app-id> --json` before selecting it as default.
- Personal Apps may use the same-origin `/api/node/v1` Local API. Do not give an
  App internal tokens, direct database paths, or Cloud dependencies.
- Build every user-facing Personal App mobile-first and deliver distinct mobile
  and desktop compositions. Share API/state code and reusable components, but
  never substitute a narrowed desktop page for the mobile surface. Follow the
  dual-surface routes and acceptance checks in `docs/personal-app-development.md`.
- Do not edit files below `../core/current`; core upgrades replace them.
- Preserve user files and databases during upgrade, rollback, and uninstall.
