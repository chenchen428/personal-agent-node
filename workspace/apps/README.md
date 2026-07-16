# Personal Apps

This directory contains user-owned, trusted local static or PWA applications.
Each App lives in a directory whose name matches the `id` in
`personal-agent.app.json`. Core updates preserve this directory.

See `docs/personal-app-development.md` in the active Core release for the
manifest, Local API, verification, default selection, and recovery workflow.
Mobile is the primary entry, but every user-facing App must provide both the
mobile and desktop compositions defined by that guide. Shared data logic is
encouraged; routing a mobile entry into desktop UI is not supported.

`personal-agent.daily-brief` is the bundled reference App. It reads mail, Online
Pages, and shared data through the same-origin Node Local API and keeps its own
bounded activity ledger under its App directory. Users may inspect or modify it;
installer upgrades add missing reference files but never overwrite existing App
files.
