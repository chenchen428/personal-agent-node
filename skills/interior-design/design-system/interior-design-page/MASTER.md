# Interior Design Page design system

Generated from the UI/UX Pro Max built-in priority rules because the host has no runnable Python interpreter for the local search database.

## Product and visual direction

- Product: professional 3D interior-design viewer for owners and designers.
- Job: make spatial evidence, level relationships, and the 6 m void immediately inspectable.
- Style: quiet workshop instrument; model-first, flat tool rails, no marketing hero, card grid, glow, gradient, or decorative motion.
- Signature: a persistent terracotta 6 m vertical marker inside the real Three.js void.

## Tokens

- Paper `#F5F4EF`, panel `#EFF0EC`, ink `#242925`, moss action `#315F4A`, terracotta dimension `#9B5B42`, line `#D3D6CF`, muted `#687169`.
- Display: Georgia only for the project title. Body: system sans. Utility and indices: system monospace.
- Corners remain square except native focus and status indicators; structure comes from rules, not nested cards.
- Minimum target 44 px; visible 3 px focus; text contrast 4.5:1; safe-area aware.

## Responsive composition

- Desktop: 68 px header, 210 px independently scrolling room index, remaining area is uninterrupted canvas; level tools top-left, camera/light tools bottom-right.
- Mobile landscape: 60 px header with room selector, full canvas, horizontally arranged level tools at top and camera tools across bottom.
- Mobile portrait: an accessible orientation dialog precedes the canvas and asks for landscape. It listens to portrait media, resize, and orientation changes, disappears automatically in landscape, and can be dismissed for a session through “仍以竖屏查看”. The dialog traps focus, supports Escape, uses a line SVG device icon, and never assumes orientation lock succeeds.

## Motion and performance

- One 1.6 s vertical reveal may explain multi-level construction. Stop on interaction and skip for reduced motion.
- No camera tour, timeline, ambient motion, remote fonts/assets, or layout animation.
- Cap renderer pixel ratio at 2 and provide the model-derived 2D projection fallback.
