# Personal App development

Personal Apps are user-owned static or PWA clients that run on Personal Agent
Node. They do not require Cloud. The optional Cloud or Edge connection only
transports authenticated requests to the same local Node gateway.

## Create an App

Create `workspace/apps/<app-id>` in the installed Personal Agent home. A minimal
App has this layout:

```text
apps/example.family-dashboard/
  personal-agent.app.json
  src/                  optional source
  dist/index.html       served entry
```

```json
{
  "apiVersion": "personal-agent/app-v1",
  "id": "example.family-dashboard",
  "name": "Family Dashboard",
  "entry": "dist/index.html",
  "requires": { "nodeApi": "1" }
}
```

The directory name must equal `id`. The entry must be an HTML file inside the
App. Only files below the entry directory are hosted. Source, data, secrets,
dotfiles, database files, source maps, unknown file types, and escaping symbolic
links are not served.

Verify and select the App with the stable JSON CLI:

```text
personal-agent app verify example.family-dashboard --json
personal-agent app set-default example.family-dashboard --json
```

The App is available at `/apps/example.family-dashboard/`. `/` opens the selected
compatible App. `/app` always opens the official recovery Console. Clear the
selection with `personal-agent app clear-default --json`.

## Mobile-first dual-surface contract

Mobile is the primary Personal App entry. Every user-facing App must ship a
purpose-built mobile surface and a desktop surface before it is considered
complete. The two surfaces may share Local API clients, state, formatters,
domain models, and reusable primitives, but they must own separate page
composition and device-appropriate interaction.

The product routes Apps through the owning shell:

| Context | Product route | App asset query |
| --- | --- | --- |
| Mobile Web | `/app/mobile/apps/<app-id>` | `?embedded=1&surface=mobile` |
| Desktop Console | `/app/apps/<app-id>` | `?embedded=1&surface=desktop` |
| Standalone/recovery | `/apps/<app-id>/` | infer from width unless `surface` is explicit |

The Core shell owns product navigation, connection state, and the active App
entry on both devices. App content must not copy a desktop sidebar or mobile
drawer that can drift from Core. Preserve the active surface in links: mobile
mail, Page, task, and App links stay under `/app/mobile`; desktop links stay
under `/app`.

A mobile surface is not a narrow desktop page. Design it first around a single
reading order, touch targets of at least 44 CSS pixels, safe-area insets,
16-pixel form controls, no horizontal overflow, and phone-specific loading,
empty, ready, long-content, and recoverable-error states. Desktop may use
denser columns and pointer interactions, while preserving the same data and
business meaning.

Before delivery, verify both explicit surfaces at representative widths (390 or
430 CSS pixels for mobile and 1280 or 1440 CSS pixels for desktop), follow every
advertised link, and confirm that mobile never opens desktop composition. An App
that implements only desktop, only relies on a responsive desktop layout, or
routes a mobile entry back into the desktop shell is incomplete.

## Node Local API v1

Apps call same-origin authenticated routes. They never receive an internal token
or a database path.

```text
GET  /api/node/v1/capabilities
GET  /api/node/v1/mail/messages
GET  /api/node/v1/mail/messages/:id
GET  /api/node/v1/data/schema
POST /api/node/v1/data/query
POST /api/node/v1/data/distinct
GET  /api/node/v1/pages
POST /api/node/v1/pages
GET  /api/node/v1/apps/<app-id>/history
POST /api/node/v1/apps/<app-id>/history
```

Success responses use `{ "schemaVersion": 1, "ok": true, "result": ... }`.
Errors use `{ "schemaVersion": 1, "ok": false, "error": { "code": "...",
"message": "..." } }`.

Shared data access remains structured and read-only: Apps can inspect objects and
query rows, but cannot receive a database path or execute SQL. App history is a
small append/list ledger stored at `apps/<app-id>/data/history.json`. Requests
must send `X-Personal-Agent-App-Id: <app-id>` matching the route. The ledger
accepts bounded `kind`, `title`, `summary`, and `sources` fields, retains the most
recent 200 items, and cannot write another App's directory through the API.

Personal Apps are trusted, user-owned same-origin code. The App ID check prevents
accidental cross-App writes and keeps storage paths separate; it is not a
cryptographic sandbox between mutually hostile Apps. Use separate origins and a
reviewed permission design if that stronger boundary is ever required.

Source checkouts include `examples/personal-apps/personal-agent.daily-brief` as a
working development reference. It combines the mail, Pages, shared data, App
catalog, and App history APIs through one shared data layer with separate
mobile-first and desktop compositions, without a Cloud dependency. Release
artifacts exclude repository examples, and installers never seed Personal Apps
into a user's Workspace.

## Updates and recovery

Installers run `private-site app-compatibility` against the candidate Core before
switching `current`; `private-site prepare` refreshes the same sanitized report
at `workspace/config/apps-compatibility.json` after activation. Updates do not
modify App files. An invalid or incompatible default App is preserved but is not
served; `/` falls back to `/app`. Encrypted Workspace backup includes `apps` and
`config/apps.json`.

Direct edits to immutable Core are a separate custom-release workflow and do not
receive the Personal App preservation guarantee. See ADR 0006 for the complete
trust, compatibility, and scope decision.
