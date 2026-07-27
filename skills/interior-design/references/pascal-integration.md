# Pascal integration boundary

Personal Agent pins `@pascal-app/core` `0.9.2`, `@pascal-app/viewer` `0.9.2`, and `@pascal-app/mcp` `0.3.2`. `scripts/build-pascal-runtime.mjs` produces a Node 22 headless bundle and an offline browser viewer bundle. The manifest records exact versions, licenses, sources, byte sizes, hashes, and runtime policies.

Only `scripts/pascal-adapter.mjs` converts project semantics to Pascal. `pascal-runtime-entry.mjs` is the internal transport wrapper; `pascal-page-client.jsx` is the read-only delivery client. Other workflow code uses the adapter and must not depend on Pascal's internal schema.

The adapter exposes the stable project/create, compile, bounded query, apply, undo, redo, validate, and Page-export boundary. Revision orchestration remains in `scene-v2.mjs`, but callers can enter it through the adapter without importing Pascal schemas or tools. Page export recursively removes private identity and trace keys before serialization.

The headless runtime connects an MCP client and server with in-memory transport. It opens no port, starts no daemon, requires no Bun, and receives no unrestricted filesystem or network capability. The allowlist contains scene reads, levels, walls, zones, measurement, bounded construction tools, patches, validation, collision checks, and history. Vision/photo sampling, arbitrary import, remote asset, and host-path tools are unavailable.

The adapter creates Site → Building → Level, then slabs, ceilings, walls, zones, real Pascal door/window nodes, stairs, guardrail fences, and a minimal procedural-furniture payload. It canonicalizes random upstream IDs into stable Personal Agent IDs, validates the canonical scene in a fresh runtime, and records reverse mappings.

An unsupported package version, missing default scene, invalid opening wall, Pascal validation error, oversized scene, or unavailable runtime fails closed with a structured error. Preserve `project.json`, the last complete history snapshot, and the previous Page artifact. Never silently substitute a decorative pseudo-scene.

The Page viewer is read-only. It loads the embedded sanitized scene and procedural items, exposes only camera, level mode, level selection, and highlighting, and falls back to a model-derived SVG plan when WebGL or Viewer initialization fails.

The rollout switch is `registry/interior-design.json` (or trusted deployment override `PERSONAL_AGENT_INTERIOR_DESIGN_ENGINE`). `legacy-v1` blocks only new v2 project creation; validate, audit, recover, scene, and Page operations remain available for retained v2 projects. `pascal-v2-preview` permits explicit v2 CLI projects, and `pascal-v2` is the post-gate default for new projects.
