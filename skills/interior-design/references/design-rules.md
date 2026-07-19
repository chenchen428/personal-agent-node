# Interior output rules

## Still image

Default composition: high isometric camera, roof removed, complete floor plan in frame, white or very light neutral background, warm-white walls, light oak and warm-grey stone, realistic but restrained furniture, soft daylight and contact shadows. Keep geometry legible; avoid cinematic depth of field, fisheye distortion, people, labels, watermarks, brand marks, or invented windows and rooms.

The prompt must distinguish structural evidence from style evidence and say that uncertain geometry is conceptual. Save the final prompt before generation. Inspect the output at delivery size for plan continuity, room adjacency, furniture scale, clipped edges, material consistency, and forbidden text.

## Interactive Page

The generated Page is a viewer, not a marketing site:

- canvas fills the viewport; no decorative card frame;
- auto-play stages floor, walls, materials, furniture, then push, lateral, and detail cameras;
- pause, replay, progress, free view, isometric, top, and walk controls are real;
- OrbitControls enables rotate, zoom, and pan after or during interruption;
- material scheme and day/evening state update live Three.js materials and lighting;
- use local assets only and provide a visible WebGL fallback;
- controls are at least 44 px, have labels/tooltips, visible focus, and safe-area spacing;
- reduced motion skips staged object transforms and camera tours, leaving the finished free-view scene;
- desktop and mobile use the same full-canvas subject with independently arranged tool groups, not a squeezed desktop panel.

Design tokens and the two-pass rationale are persisted under `design-system/interior-design-page/`.

