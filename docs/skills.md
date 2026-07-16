# Skills

`registry/skills.json` is the authoritative skill catalog and top-level `skills/` is the portable source installed on a customer machine. The universal set is grouped into:

- Research & Knowledge: structured research and source capture.
- Writing & Content: article structure, editing, translation, and HTML preparation.
- Visual & Media: visual planning, deterministic media work, Guizang social cards, and Guizang web presentations.
- Travel & Location: source-backed, feasible, printable travel guidebooks.
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
| Product Engineering | `skills/frontend-design`, `skills/ui-ux-pro-max` |
| Publishing & Automation | `skills/personal-agent` |

The catalog records exact upstream revisions, licenses, risks, security boundaries, related skills, and reproducible cases. The installed release seeds the complete `skills/` tree into the customer's mutable Workspace.

Owner-specific `blog-publishing` is excluded. `release-ops`, `open-agent-bridge`, and the old `guizang-social-card` copy are replaced by `personal-agent-operations`, `personal-agent`, and the pinned latest `guizang-social-card-skill`. `travel-planner` and `amap-jsapi` remain excluded because their upstream repositories declare no redistribution license. Run `node scripts/skill-tree.mjs catalog` to inspect the installed set.
