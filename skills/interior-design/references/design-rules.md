# Interior output rules

## Still render

Default to a high isometric, roofless dollhouse on a light neutral background with restrained real materials, legible furniture, soft daylight, and contact shadows. Distinguish structure evidence from style evidence and describe uncertain geometry as conceptual.

Inspect the final image at delivery size for plan continuity, room adjacency, furniture scale, clipped edges, material consistency, and invented text. Avoid cinematic depth of field, fisheye distortion, people, labels, watermarks, brand marks, and ungrounded windows or rooms.

## Interactive Page

- Render the finished model immediately. No automatic build sequence, camera tour, timeline, playback, or decorative motion.
- Keep the whole plan in frame by default. Room selection changes the camera target and distance to a genuine close view.
- OrbitControls provides rotate, pan, and zoom. View and reset controls have accessible names, visible focus, and observable results.
- Use only the shipped local Three.js bundle. Do not load remote assets or fonts.
- Keep the subject dominant. Desktop may use a compact room rail; mobile landscape places the room selector in the Header and a compact view toolbar at the lower right.
- Provide a non-blocking portrait orientation hint and a model-derived projection fallback when WebGL is unavailable.
- Keep the Page read-only. Agent-authored model and copy are the only editing surface.
- Keep numeric dimensions in the floor-plan annotation layer. SU views use concise space/component labels without width tags.
- A partial second floor over a double-height hall must preserve the main void and show a feasible stair approach, guardrail, headroom, structural-review note, and unobstructed circulation.

## Mandatory design walkthrough

- Walk every daily route from the entrance through the living zone, bedrooms, kitchen, bathrooms, and balconies. A decorative composition is not acceptable if a person cannot pass naturally.
- Open every door, cabinet, drawer, and appliance in the mental walkthrough. Reject furniture that blocks a swing, access panel, operating area, or window.
- Check furniture footprints against room boundaries and each other. Keep usable approach space beside beds, seats, dining chairs, wardrobes, kitchen worktops, laundry, and sanitary fixtures.
- Trace every recorded user requirement to an observable model decision. If a requirement conflicts with structure evidence or safe circulation, surface the conflict instead of hiding it.
- Run `cli.mjs audit` after every geometry or furniture change and once more after desktop/mobile Page review. Any blocking finding prevents delivery.
- Render widths, wall thicknesses, clearances, and furniture dimensions as architectural dimension lines with two end ticks and attached values, not as floating tags alone.
- Keep the label visibility control available in mobile landscape and verify a readable mobile subset.
- For demolition, identify the exact room by adjacency and orientation on the user-supplied drawing and review the overlay on that room before delivery.
