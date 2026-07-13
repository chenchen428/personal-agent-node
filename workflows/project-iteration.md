# Project iteration

1. Update `registry/projects.json` before moving or adding a project.
2. Keep runtime state in `.local/` or the configured data root.
3. Run `node scripts/project-guard.mjs --working`.
4. Run the affected package tests, then `npm test` and `npm run check`.
5. Build and verify an immutable release artifact before installation.
