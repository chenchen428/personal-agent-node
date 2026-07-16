# Frontend Development Principles

This is the local engineering contract for the Personal Agent Web Console, desktop shell, mobile pages, and Personal Apps. Product behavior and appearance still come from approved files under the parent workspace's `docs/prototypes/`.

## Single responsibility

Each component owns one primary concern. A page may compose a heading, filters, a list and a detail panel, while reusable data loading, formatting, navigation and UI primitives live outside the page.

Do not use one large component as a switchboard for unrelated screens.

## Reuse before duplication

Extract behavior when multiple consumers need the same contract. Typical shared units include navigation definitions, page headings, filters, pagination, empty states, API hooks, formatters and Personal App host behavior.

Reuse behavior and semantics, not only copied CSS.

## 300-line component limit

Every authored `.tsx` file under `core/app/src/components/` must contain no more than 300 physical lines. The limit is a ceiling, not a target. Split earlier when responsibilities are already separable.

Generated files and CSS are governed separately. Minifying handwritten source to evade the limit is not compliant.

## One menu destination, one page component

Every primary menu route owns an independently named page component module. Route files import that page directly. Shared shells and primitives may wrap it, but unrelated menu pages must not share a single implementation module.

Personal Apps do not own product navigation. Desktop and mobile render inside their respective core Personal App hosts, preserving the same brand, menu, active state and lifecycle controls. Their standalone asset route remains available for recovery access.

Mobile is the primary Personal App surface, and desktop support is still required. Share data clients, state, semantics and reusable primitives, but keep device-specific page composition separate. A desktop layout compressed by media queries is not a mobile implementation. Mobile App links must use `/app/mobile/apps/<app-id>` and must not fall back into the desktop shell. Follow the complete contract in `docs/personal-app-development.md`.

## Independent scrolling

At desktop width, the product shell occupies the viewport:

- the sidebar has its own vertical overflow boundary;
- the main column owns a separate content scroller;
- the top bar remains inside the main column;
- scrolling a long page never moves the sidebar.

Responsive mobile layouts may return to document scrolling when the sidebar becomes a drawer.

## Real acceptance data

Production code must not silently fabricate customer content. Design prototypes may use representative content, and local acceptance installations may be populated with clearly scoped demo records. Acceptance data must flow through the same APIs and local stores as ordinary data so mail, Pages, tasks, conversations, data objects and Personal Apps exercise their real integration paths.

## Verification

Run:

```bash
npm run frontend:guard
npm run app:typecheck
npm run app:build
```
