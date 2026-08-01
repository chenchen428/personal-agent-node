# Interior-design delivery v3

The interior-designer Agent owns one deterministic representative delivery contract at `agents/interior-designer/examples/featured-delivery.json`. Generate delivery version 3 from a quality-gated v2 project with the contract command. Do not recreate a visually similar Page or author the representative artifact separately.

## Primary booklet

`index.html` is the primary delivery and uses the `renovation-booklet` layout. It is a normal responsive, printable document whose information order follows a professional renovation PDF:

1. project cover, summary, scope, and confirmed requirements;
2. source-plan evidence and Agent annotation;
3. complete design explanation and the link to specialist Pages;
4. floor-plan proposal;
5. ordered conceptual renders with purpose and limitation labels;
6. material list and budget scope;
7. requirement-to-scene-to-material-to-view consistency matrix;
8. project transitions, revision history, and user confirmation points;
9. exclusions, unresolved boundaries, implementation order, and site-measure/professional-verification checklist.

The booklet must not embed the interactive 3D viewer or use a forced-landscape layout. Complex professional content is linked from a clear specialist card. The 3D link is the relative URL `3d/index.html`, uses `target="_blank"`, and opens as a separate browser page. The main booklet and every child Page come from the same revision, scene, audit, and manifest.

## 3D specialist Page

`3d/index.html` owns the historical `su-design-classic` full-canvas shell and Pascal viewer. It has the pale edge-to-edge canvas, floating controls, orthographic-plan mode, label controls, reset, and a relative link back to the booklet. It warms the viewer automatically. A dedicated loading surface covers the Canvas until the first valid frame; controls and labels stay unavailable during that interval. A real viewer error may reveal the accessible model-derived SVG fallback.

This specialist Page is a focused model viewer, not a second delivery document. Requirements, project narrative, material and budget explanations, process history, and professional-boundary sections belong only to the primary booklet and must not be duplicated here.

Only this specialist Page uses the forced mobile-landscape contract. Mobile detection combines the browser mobile signal with touch-screen bounds; portrait mobile exchanges live viewport dimensions and rotates the Page root by 90 degrees, while desktop narrow windows stay unrotated. The renderer sizes itself from the exchanged logical viewport. The contract forbids a portrait fallback or rotate-device prompt. Mobile labels default hidden and collision handling keeps their visible set bounded.

The viewer consumes the same sanitized `designQuality` data covered by the compiled scene hash. Room floors and furniture use the governed PBR palette, local lights and exposure use the executable lighting plan, and the initial shot uses the first governed delivery camera. The read-only Page does not expose editing or save controls.

## Privacy, packaging, and publication

Both Pages are offline artifacts. They cannot call MCP or Agent tools, read arbitrary files, access loopback, load remote content, execute evidence markup, or contain Space, owner, or managed-object IDs. CSP denies network, frames, plugins, external fonts, workers, media, and form submission. The redacted user source plan and Agent annotation remain separate same-origin image files referenced from the booklet. Only the minimal sanitized viewer payload is embedded in the 3D HTML.

Generation writes `index.html`, `3d/index.html`, `scene.json`, `audit.json`, `manifest.json`, and `media/`. Images are never base64-inlined. Every file independently obeys the publication file limit. The manifest records the primary layout, every specialist Page path and layout, Agent identity, delivery version, engine, project revision, scene and audit provenance, concept-render provenance, and exact size and SHA-256 for every declared file. It must not contain template provenance.

The representative builder initializes the synthetic project, replays its confirmed workflow events, imports the governed render set, compiles the Pascal scene, runs the professional audit, invokes `render-interior-pages` v1, derives `cover.svg`, and records exact hashes. The renderer emits `agent-review.json`; the Agent must inspect its five targets and revise only governed project data before rerendering. `--check` regenerates everything and fails on byte, workflow, provenance, link, CSP, quality, or manifest drift.

Publish the directory as one Page bundle using `index.html` as its entry. The primary Page is the only delivery URL shown by default; its relative specialist links resolve inside the same immutable bundle. Natural-language changes create a new project revision, audit, bundle, and publication.

Automated acceptance covers schema, scene, semantic HTML, accessibility markers, CSP, privacy, links, file size, hashes, primary and specialist layout markers, and the automatic viewer lifecycle. Do not mark visual acceptance passed. Report `visualAcceptance: user` until the user reviews the booklet and linked 3D Page on desktop and mobile.
