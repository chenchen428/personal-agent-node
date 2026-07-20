# Interior output rules

## Still render

Default to a high isometric, roofless dollhouse on a light neutral background with restrained real materials, legible furniture, soft daylight, and contact shadows. Distinguish structure evidence from style evidence and describe uncertain geometry as conceptual.

Inspect the final image at delivery size for plan continuity, room adjacency, furniture scale, clipped edges, material consistency, and invented text. Avoid cinematic depth of field, fisheye distortion, people, labels, watermarks, brand marks, and ungrounded windows or rooms. A still may illustrate an already validated model; it must not decide walls, stairs, voids, or level layout.

## Interactive Page

- Render the complete model in the first frame. An optional short, model-derived vertical reveal may clarify multi-level geometry; reduced-motion skips it and user interaction cancels it.
- Keep the whole plan in frame by default. Room selection changes the camera target and distance to a genuine close view.
- OrbitControls provides rotate, pan, and zoom. Camera, level/cutaway, light, and reset controls have accessible names, visible focus, targets at least 44px, and observable results.
- For duplexes, whole, lower, upper, and section modes must show a real difference. Stairs connect level elevations, upper slabs avoid voids, railings guard open edges, and the void has a visible height marker.
- Use only the shipped local Three.js bundle. Do not load remote assets or fonts.
- Keep the subject dominant. Desktop may use a compact room rail; mobile uses a full canvas, a header selector, and compact top/bottom toolbars that do not cover the model.
- Provide safe-area padding, a non-blocking portrait hint, and a model-derived projection fallback when WebGL is unavailable.
- Keep the Page read-only. Agent-authored model and copy are the only editing surface. Do not add auto tours, timelines, playback controls, or decorative motion.
