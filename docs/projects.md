# Projects

`registry/projects.json` is the authoritative project inventory. Product source lives under `projects/core/`; runtime data never does. Use `node scripts/discover-projects.mjs list` to inspect the inventory and `node scripts/project-guard.mjs --working` before changing project boundaries.
