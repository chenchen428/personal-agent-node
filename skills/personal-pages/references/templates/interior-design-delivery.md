# Interior Design Delivery

Template ID: `interior-design-delivery`
Implementation: version `1`, generated only by `node skills/interior-design/scripts/cli.mjs page --template interior-design-delivery --source-plan <redacted-user-floor-plan>`
Artifact marker: `personal-agent-page-template`

Use this template for装修设计、室内设计、户型改造、家居布局、平面图、SketchUp 或 SU 设计稿 Page requests. Invoke the `interior-design` Skill before generation.

## Required inputs

Require the user's floor plan and key dimensions. Keep the supplied plan redacted in the deliverable and retain the Agent requirement digest. If evidence is missing, identify it before generation; never substitute the example plan.

## Fixed framework

- Keep 原始图、调整标注、SU 设计稿 three-view switching.
- Keep the requirement digest and revision history.
- Keep floor switching when the user's source has multiple floors.
- Keep entry door, interior doors, windows, balconies, walls, furniture, cabinets, and life-detail components.
- Use SketchUp-style low-polygon architectural expression.
- Keep 3D and plan views plus hideable detail annotations.
- Deliver independent desktop and mobile-landscape layouts with touch controls.

## Agent freedom

Adapt requirement summaries, revision marks, geometry, room relationships, doors, windows, balconies, furniture, cabinets, daily-life objects, and annotation content only from the user's evidence.

## Acceptance

Run the deterministic geometry audit and template-contract verification. The generated HTML must carry the registered artifact marker, template ID, implementation version, and the same `SU 设计稿 / 户型图 / 用户需求` delivery structure shown by the configured template page. Locate demolition from plan adjacency, use architectural dimension lines, retain responsive markup and touch controls, and expose no desktop wheel hint or browsing-space narration in the mobile contract.

Do not open a browser, take screenshots, perform visual click-through acceptance, or declare appearance approved. Publish the Page and ask the user to accept its visual and interaction result.
