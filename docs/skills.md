# Skills

`registry/skills.json` is the authoritative skill catalog and top-level `skills/` is the portable source installed on a customer machine. The universal set is grouped into:

- Research & Knowledge: structured research and source capture.
- Writing & Content: article structure, editing, translation, and HTML preparation.
- Visual & Media: visual planning, deterministic media work, Guizang social cards, and Guizang web presentations.
- Travel & Location: source-backed, feasible, printable travel guidebooks.
- Home & Living: traceable renovation decisions plus calibrated 2D-to-3D concept models, managed stills, and interactive floor-plan Pages.
- Product Engineering: distinctive frontend direction and a searchable UI/UX design database.
- Publishing & Automation: governed local Personal Agent operations.

These are customer capabilities and belong only to the Node Harness. The private parent Harness keeps project development, operations, and acceptance skills; it does not duplicate customer content skills.

## Installed directories

| Category | Portable skill directories |
| --- | --- |
| Research & Knowledge | `skills/deep-research`, `skills/knowledge-capture` |
| Writing & Content | `skills/content-workbench` |
| Visual & Media | `skills/visual-content`, `skills/media-toolkit`, `skills/guizang-social-card-skill`, `skills/guizang-ppt-skill` |
| Travel & Location | `skills/travel-guidebook` |
| Home & Living | `skills/home-renovation`, `skills/interior-design` |
| Product Engineering | `skills/frontend-design`, `skills/ui-ux-pro-max` |
| Publishing & Automation | `skills/personal-agent` |

The catalog records exact upstream revisions, licenses, risks, security boundaries, related skills, and reproducible cases. The installed release seeds the complete `skills/` tree—including bundled local Three.js Page assets—into the customer's mutable Workspace on both new installation and upgrade.

## Skill ownership and evolution principles

- Extend the existing owning Skill when a new workflow serves the same user intent, product boundary, security model, and installation lifecycle. Put substantial subordinate instructions in a directly linked `references/` file so the main `SKILL.md` stays concise.
- Create a new top-level Skill only when the capability has an independently useful trigger, distinct domain ownership or security boundary, and enough reusable procedure to justify occupying the universal catalog. Do not create a Skill merely to name one command or one narrow branch of an existing product workflow.
- Do not add a product CLI command only to wrap a stable external tool. A Skill may govern tools such as `gh` directly when the tool's own authenticated identity and confirmation surface are the intended contract. Add `personal-agent` or `pa-cli` commands only when Node owns a stable product capability, schema, permission check, audit contract, and compatibility promise.
- Keep portable Skill source only under top-level `skills/`. `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md` are generated compatibility bridges; never copy or edit Skill source through those paths. Customer-created drafts and mutable outputs belong under the user-owned `workspace/`, not inside a Skill directory.
- Preserve least privilege and public/private boundaries. Any Skill that performs an external write must declare it in `registry/skills.json`, follow the R0-R3 confirmation contract, minimize outbound data, treat remote content as untrusted, and verify the result without exposing credentials.
- Update the owning Skill metadata, direct references, registered cases, and catalog entry together. If the change adds or alters a Node-owned CLI or product capability, also update command and capability registries, behavior baselines, schemas, implementation, semantic tests, packaging, and acceptance evidence.
- Scan the complete public diff before delivery. Private Cloud behavior, operator configuration, secrets, customer content, local paths, and parent-workspace assumptions must never enter the public Node release.

Owner-specific `blog-publishing` is excluded. `release-ops`, `open-agent-bridge`, and the old `guizang-social-card` copy are replaced by `personal-agent-operations`, `personal-agent`, and the pinned latest `guizang-social-card-skill`. `travel-planner`, `amap-jsapi`, and `pinterest-interior-design-skill` remain excluded because their upstream repositories declare no redistribution license. The workspace-authored `home-renovation` Skill independently covers the broader renovation lifecycle without copying those sources. Run `node scripts/skill-tree.mjs catalog` to inspect the installed set.
