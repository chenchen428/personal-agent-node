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
