---
name: render-interior-pages
description: Deterministically render governed interior-design project data into a responsive renovation booklet and a separate Pascal 3D Page, then return automatic checks and a required Agent inspection loop. Use when the interior-designer needs to create, preview, inspect, revise, or regenerate 装修设计 Pages; never use it to author arbitrary HTML, CSS, or JavaScript.
---

# Render Interior Pages

Treat this Skill as the only Page renderer for `interior-designer`. The design Agent owns project facts, scene data, materials, views, copy, and revision decisions. This renderer owns layouts, responsive behavior, 3D controls, offline packaging, validation, and upgrade compatibility.

## Render

Read [contract.md](references/contract.md), then render from the current quality-gated project:

`node skills/render-interior-pages/scripts/cli.mjs render --project-dir <project-dir> --output <project-dir>/derived/page --json`

Do not write or patch `index.html`, `3d/index.html`, CSS, viewer JavaScript, or manifest fields. If output is wrong, change the governed project data or scene and render a new revision.

The renderer must return a primary booklet, a separate `3d/index.html`, assets, exact hashes, automatic diagnostics, and `agent-review.json`. Unsupported contract majors and automatic blockers fail closed.

The primary booklet owns requirements, project narrative, materials, process, and professional boundaries. The separate 3D Page is a focused model viewer only: identity, model canvas, loading/error state, navigation back to the booklet, and model-view controls. Never duplicate requirements or booklet explanation sections inside the 3D Page.

## Inspect and iterate

After every render, read `agent-review.json` and inspect every required target: booklet desktop, booklet mobile, 3D desktop, 3D mobile portrait forced into the landscape canvas, and native mobile landscape. Use the returned relative preview entries or the authenticated same-origin publication; never invent a loopback or public URL.

Record observations using [agent-review-v1.schema.json](references/agent-review-v1.schema.json), then evaluate them:

`node skills/render-interior-pages/scripts/cli.mjs review --bundle <page-dir> --input <observations.json> --json`

If any target needs change, revise project data and rerender. Do not bypass the loop by editing generated Page code. A successful Agent review means only that the result is ready for user review; `visualAcceptance` remains `user`.

## Boundaries

- Keep the renderer offline and deterministic. Do not fetch remote assets or execute evidence markup.
- Preserve the approved `renovation-booklet`, `su-design-classic`, Pascal v2, forced-mobile-landscape, true-landscape gesture, CSP, privacy, and professional-boundary contracts.
- Keep requirements and explanatory narrative in the booklet; keep the specialist 3D Page free of requirement, material, process, and delivery-description sections.
- Keep renderer upgrades backward-compatible within the same request-schema major. Pin the renderer version in the manifest and regenerate from source data to receive compatible upgrades.
- Publish the complete immutable bundle only after automatic checks and Agent review are ready. User visual and interaction acceptance remains the final gate.
