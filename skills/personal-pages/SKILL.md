---
name: personal-pages
description: Select a registered Page template, delegate Page creation, publish governed HTML and assets, and verify desktop and mobile Page delivery. Use for creating or redoing a Personal Agent Page, inspecting Page templates, publishing private or public Pages, producing gallery screenshots, or returning Page and Activity links.
---

# Personal Pages

Before creating or redoing a Page:

```text
pa-cli pages templates list --json
pa-cli pages templates inspect --id <matching-template-id> --json
```

Compare every template's `useWhen` and `matchTerms`. Inspect every semantic match and select all required contracts before delegation. Pass the template ID, linked Skill, full contract, original user materials, constraints, and acceptance criteria into the child task.

Each built-in template has one description file under `references/templates/`. Read the matching file after inspecting the runtime contract:

- [interior-design-delivery.md](references/templates/interior-design-delivery.md)

Use a generic Page workflow only when no registered template matches. Never use template example content as user data.

Read [publishing.md](references/publishing.md) for asset upload, dual-device screenshots, publication, link safety, and Page Activity targeting.
