# Personal Apps

This directory contains user-owned, trusted local static or PWA applications.
Each App lives in a directory whose name matches the `id` in
`personal-agent.app.json`. Core updates preserve this directory.

See `docs/personal-app-development.md` in the active Core release for the
manifest, Local API, verification, default selection, and recovery workflow.
Mobile is the primary entry, but every user-facing App must provide both the
mobile and desktop compositions defined by that guide. Shared data logic is
encouraged; routing a mobile entry into desktop UI is not supported.

Release installers create this directory without installing any App. Personal
Apps are user-created content, so repository examples are kept outside the
Workspace seed and are never copied into a user's installation.
