# Interior Design Delivery

Template ID: `interior-design-delivery`
Implementation: version `2`
Generator: `node skills/interior-design/scripts/cli.mjs page --template interior-design-delivery --project-dir <space-owned-project-dir> --output <project-dir>/derived/page --json`
Artifact marker: `personal-agent-page-template`
Publication: fail-closed artifact validation and persisted template provenance are required

Use this template for装修设计、室内设计、户型改造、家居布局、复式/别墅、多层空间、平面图、SketchUp/SU, Pascal model, or professional renovation Agent Page requests. Invoke `interior-design` before generation.

## Required project

Require the trusted Space-owned project v2, current compiled Pascal scene, matching deterministic audit, a redacted user-uploaded source-plan image, and a redacted Agent-uploaded revision-annotation image. The source image SHA-256 must match project provenance, every concept's model-basis reference, the compiled scene, and the Page payload; 3D, orthographic plan, labels, and derived explanations must therefore share the displayed user upload. The project records evidence, scale confidence, brief, requirements, concepts, assumptions, unknowns, professional verifications, materials, budget, revisions, and provenance. Never substitute the example project or let user JSON self-assert Space/owner identity.

The catalog cover, desktop/mobile detail preview, and opened example all consume the same committed artifact generated from `skills/interior-design/examples/professional-template/seed.json` by `build-template-example.mjs`. The manifest records the native seed, evidence, governed project, Pascal scene, professional audit, and every delivered file hash. This example proves the generator contract; it is never a customer design seed.

## Fixed framework

- User-uploaded source-plan image, Agent-uploaded revision-annotation image, Pascal design model, requirements, and revision history. The two plan images use ordinary `<img>` elements; the Page does not redraw or annotate them.
- Floor switching plus stacked, solo, and exploded level modes.
- Real door/window openings, balconies/key components, slabs, ceilings, stairs, voids, guardrails, procedural furniture, cabinets, and major equipment where relevant.
- A complete model-derived architectural cutaway: continuous room surfaces, continuous wall enclosure cut around real doors/windows, balcony guardrails, and furnished rooms visible together in the primary isometric view. A floor plan, isolated wall lines, or scattered furniture alone is a quality regression.
- The `professional-mesh-ink` render profile: rendered shading, WebGPU-safe geometry ink, stable shadows, material contrast, and an automatically framed full-house composition.
- Dedicated cold-start loading state, visibly distinct isometric 3D and top-down orthographic views, hideable labels, issue/requirement highlighting, and model-derived SVG failure fallback.
- Concept A/B comparison or a visible single-option reason.
- Assumptions, unknowns, professional verifications, quality report, and concept-design disclaimer.
- Independent desktop and mobile-landscape layouts with accessible buttons, keyboard operation, state text, and non-3D summaries.

## Security and acceptance

The Page is read-only and self-contained. It loads no remote assets, CDN, iframe, external font, analytics, file URL, loopback API, MCP, or Agent tool. CSP denies network and active embedding. The payload excludes Space, owner, managed-object, project-path, and credential fields. Only redacted evidence may be embedded.

Run schema, scene hash, quality, template, semantic HTML, CSP, privacy, offline-resource, size, and deterministic-hash checks. Require template v2, `pascal-v2`, artifact marker, and `visualAcceptance: user`.

The architectural presentation layer must be deterministically derived from the current Pascal `scene.json`; never maintain a second hand-authored model. The built-in professional example is a minimum visual-completeness baseline, not merely a node-count fixture.

Do not open a browser, take screenshots, perform click-through acceptance, or declare appearance approved. Publish with `pa-cli pages publish --template interior-design-delivery`; require `page.template` to repeat the inspected contract digest and to contain the exact HTML artifact SHA-256. Return the actual Page ID/link result and leave visual and interaction acceptance to the user. A revision returns to the main Agent and creates a new project revision and immutable artifact.
