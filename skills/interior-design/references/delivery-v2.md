# Interior-design delivery v2

The only registered implementation is `interior-design-delivery` version 2. Generate it from a quality-gated v2 project with the registry command. Do not recreate a visually similar page.

The fixed structure includes source plan, revision annotation, Pascal design model, requirements and revision history, floor selection, real doors/windows and key components, 3D/orthographic views, labels, desktop/mobile-landscape layouts, concept comparison, stacked/solo/exploded levels, issue and requirement highlighting, assumptions, unknowns, professional verification, revision summary, and a model-derived SVG fallback.

The Page is a read-only artifact. It cannot save scene changes, call MCP or Agent tools, read files, access loopback, load remote content, execute evidence markup, or contain Space/owner/managed-object IDs. CSP denies network, frames, plugins, external fonts, workers, media, and form submission. Only the redacted source-plan copy and minimal viewer payload are embedded.

Generation writes exactly `index.html`, `scene.json`, `audit.json`, `template.json`, and `manifest.json`; the directory limit is 20 MiB. The verifier scans template metadata, CSP, remote executable assets, Pascal/CDN hosts, loopback/file URLs, development paths, source maps, and private identity fields.

The built-in catalog example is not a separately authored preview. `scripts/build-template-example.mjs` initializes `examples/professional-template/seed.json` as a governed project, compiles its Pascal scene, runs the same professional audit, calls the same Page generator, derives an isometric `cover.svg` from the selected model, and records seed, evidence, project, scene, audit, and file hashes in the committed manifest. The built-in example also enforces a non-regression floor of 12 rooms, 30 procedural furniture/equipment items, 14 openings, 8 doors, and 6 windows, plus model labels and requirement highlighting. These thresholds protect the catalog quality reference; customer projects must reflect actual evidence rather than inventing elements to satisfy the example floor. `--check` regenerates the artifact and fails on any byte or quality drift.

Publication uses `pa-cli pages publish`. Record the returned immutable Page ID and artifact hash. Natural-language changes return to the main Agent, create a structured revision, rerun the gate, generate a new artifact, and publish a new version. Rollback selects a previous immutable artifact.

Automated acceptance covers code, schema, scene, semantic HTML, accessibility markers, CSP, privacy, routes, size, and deterministic hashes. Do not open a browser, take screenshots, click through, or mark visual acceptance passed. Report `visualAcceptance: user` and keep it pending until the user reviews desktop and mobile interaction.
