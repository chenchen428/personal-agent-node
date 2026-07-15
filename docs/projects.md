# Projects

`registry/projects.json` is the authoritative product inventory. Personal Agent Node source lives under `core/`; the customer Harness and all user-owned state live under `workspace/`. The historical `projects/` layer has been removed. Use `node scripts/discover-projects.mjs list` to inspect the inventory and `node scripts/project-guard.mjs --working` before changing product boundaries.
