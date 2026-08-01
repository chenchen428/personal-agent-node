# Professional project schema v2

The trusted Space context supplies `spaceId`, `ownerId`, and the absolute Space root. User JSON never supplies authority. A project directory must be a non-symlink child of `<space-root>/projects/` named `home-renovation-<lowercase-slug>`.

## Governed files

`project.json` is the design authority. `scene.json` is the compiled Pascal delivery authority. `derived/audit.json` is the deterministic gate result. `derived/manifest.json` records revision hashes. `.runtime/pascal.db` is a per-project Node SQLite index with checked schema and ownership; it is not shared and never replaces JSON authority. `history/` keeps the latest 50 revisions and preserves older revisions under `history/archive/`.

`provenance.interiorDesignEngine` is immutable and equals `pascal-v2`. `registry/interior-design.json` requires this single engine for every production project. `provenance.sourcePlanEvidenceId` selects the single user-uploaded `structure-reference` used as the model basis, and `provenance.sourcePlanSha256` must equal that evidence record's content hash. Every concept repeats the same `sourcePlanEvidenceId`; a mismatch blocks validation, scene audit, and Page generation.

Writes use a project lock, `baseRevision`, bounded JSON, prototype-key rejection, temporary files, fsync, atomic rename, history snapshots, and manifest hashes. A stale revision returns `REVISION_CONFLICT` with the current revision and replay guidance.

If a crash or tamper makes the current files disagree with the manifest, reads fail closed. `project recover --revision <n>` verifies the selected history project, matching scene, audit, Space identity, and hashes before restoring it. The replaced state is retained privately under `.runtime/recovery/`.

## Evidence

Each evidence record has a stable ID, governed managed-object reference or safe `evidence/` relative path, classification, orientation, calibration, confidence, allowed uses, observations, inferences, redaction status, and SHA-256. `structure-reference` identifies the user-uploaded floor plan and is the unique basis for the structured concept, Pascal 3D, orthographic plan, labels, and derived design explanations; `revision-annotation` identifies the separate image that the Agent produces and uploads after analysis. An optional `concept-render` is a passive delivery image derived from the governed design; it must allow delivery and record `imagegen` plus reference-image and prompt hashes without storing private prompt text. The Page never synthesizes these images in the browser. Observations describe only what is visible or measured; inferences remain separate. Contradictory verified calibrations for the same segment block compilation. Missing reliable scale is allowed only as an explicitly labeled concept.

Managed references must use the Node `obj_<24 hex>` contract and remain inert inside this Skill. The main Agent and `personal-files` validate current-Space ownership before materializing a copy; the v2 CLI never dereferences an arbitrary managed ID or cross-project path. Page delivery accepts only a redacted project-local evidence copy.

Only `redacted` or `not-required` evidence under the project `evidence/` directory may enter a Page. Images are signature-checked, size-bounded, passive data. SVG scripts, event handlers, remote references, entities, styles, and embedded images are rejected.

## Brief, concepts, and traceability

The brief records household, scope, budget, schedule, and requirements. Requirement priorities are `must`, `should`, `prefer`, and `avoid`; statuses are `unresolved`, `satisfied`, `partially-satisfied`, `blocked`, and `rejected-with-reason`. A satisfied `must` links to scene nodes or a reproducible verification result. A blocked `must` stays user-visible.

Keep assumptions, unknowns, and professional verifications independent. Concepts record summary, tradeoffs, budget allocation, and complete levels. Provide at least two concepts unless `singleOptionReason` explains the constraint.

The selected concept supports at most two levels, 30 rooms, and 500 modeled elements in the v2 baseline. Each level owns footprint, rooms/zones, walls, openings, items, stairs, voids, and guardrails. IDs are stable semantic IDs, not render-order IDs.

## Scene-bound design quality

`designIntent.materials` is an executable PBR palette, not a mood-board label list. Every referenced material records a stable ID, name, category, six-digit base color, roughness, metalness, optional opacity, maintenance requirements, and wet-area suitability where applicable.

`designIntent.lighting` records bounded local lights with stable IDs, supported kinds, intensity, color temperature, color, and the position/target required by that kind. `designIntent.rendering` records real-time and final profiles, exposure, geometry lock, AI-enhancement policy, control passes, and ordered delivery cameras. A camera has a stable ID, name, role, optional room, finite position and target, 20-90 degree field of view, and sequence.

Every new item receives an `assetProfile` with a stable local asset ID, version, floor/wall/ceiling anchor, fixed or bounded-proportional scale policy, and non-negative front/back/left/right/top operating clearance. Asset profiles are part of the project revision and may not be fetched from a remote runtime library.

The compiled `scene.json` carries a sanitized `designQuality` projection. Its scene hash covers Pascal geometry, furniture and asset instances, materials, lighting, cameras, and rendering policy. Any quality change therefore invalidates the prior compiled scene and Page even when wall geometry is unchanged.

## Demand workflow

`demandWorkflow` version 1 is a deprecated, read-only presentation snapshot retained only to reproduce the committed historical representative delivery. It is not authorization state for customer work and its CLI advance command is retired. The current conversation and confirmation authority is `agents/interior-designer/workflow.json` schema v2, operated through `scripts/specialist-workflow.mjs`: a private mobile-first progress Page is mandatory, short requirements use text confirmation, and every substantial design artifact uses an exact-`pageId` Page confirmation. Its fixed route is initial requirements → annotated floor-plan adjustments → 3D design → exactly one style sample → at least 15 entrance-first ordered views → final delivery → delivered. Only explicit “按推荐走” authorization may combine the floor-plan and 3D gates into one 3D Page checkpoint.

Inside the deprecated representative snapshot, `styleProfile` contains one confirmed primary direction and at most one secondary direction. `renderStoryboard` and `renderSet` retain the old Page's image provenance so the historical artifact can be reproduced. These legacy fields do not satisfy the current workflow's one-sample or 15-view gates; those gates are evaluated exclusively from the v2 specialist workflow state and its Page artifacts.

## Revision contract

Every workflow transition, compile, or apply produces a new immutable revision. Structured operations may select a concept, update requirement state or material intent, and add, remove, or update bounded scene elements. Undo and redo restore design state into a new revision. Publication never mutates an earlier artifact.
