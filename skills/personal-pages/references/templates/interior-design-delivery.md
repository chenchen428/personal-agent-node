# Interior Design Delivery

Template ID: `interior-design-delivery`
Implementation: version `2`
Generator: `node skills/interior-design/scripts/cli.mjs page --template interior-design-delivery --project-dir <space-owned-project-dir> --output <project-dir>/derived/page --json`
Artifact marker: `personal-agent-page-template`

Use this template for装修设计、室内设计、户型改造、家居布局、复式/别墅、多层空间、平面图、SketchUp/SU, Pascal model, or professional renovation Agent Page requests. Invoke `interior-design` before generation.

## Required project

Require the trusted Space-owned project v2, current compiled Pascal scene, matching deterministic audit, and redacted source-plan evidence. The project records evidence, scale confidence, brief, requirements, concepts, assumptions, unknowns, professional verifications, materials, budget, revisions, and provenance. Never substitute the example project or let user JSON self-assert Space/owner identity.

The catalog cover, desktop/mobile detail preview, and opened example all consume the same committed artifact generated from `skills/interior-design/examples/professional-template/seed.json` by `build-template-example.mjs`. The manifest records the native seed, evidence, governed project, Pascal scene, professional audit, and every delivered file hash. This example proves the generator contract; it is never a customer design seed.

## Fixed framework

- Source plan, revision annotation, Pascal design model, requirements, and revision history.
- Floor switching plus stacked, solo, and exploded level modes.
- Real door/window openings, balconies/key components, slabs, ceilings, stairs, voids, guardrails, procedural furniture, cabinets, and major equipment where relevant.
- 3D and orthographic views, hideable labels, issue/requirement highlighting, and model-derived SVG fallback.
- Concept A/B comparison or a visible single-option reason.
- Assumptions, unknowns, professional verifications, quality report, and concept-design disclaimer.
- Independent desktop and mobile-landscape layouts with accessible buttons, keyboard operation, state text, and non-3D summaries.

## Security and acceptance

The Page is read-only and self-contained. It loads no remote assets, CDN, iframe, external font, analytics, file URL, loopback API, MCP, or Agent tool. CSP denies network and active embedding. The payload excludes Space, owner, managed-object, project-path, and credential fields. Only redacted evidence may be embedded.

Run schema, scene hash, quality, template, semantic HTML, CSP, privacy, offline-resource, size, and deterministic-hash checks. Require template v2, `pascal-v2`, artifact marker, and `visualAcceptance: user`.

Do not open a browser, take screenshots, perform click-through acceptance, or declare appearance approved. Publish with `pa-cli pages publish`, return its actual Page ID/link result, and leave visual and interaction acceptance to the user. A revision returns to the main Agent and creates a new project revision and immutable artifact.
