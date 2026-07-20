# Concept model contract

Use `schemaVersion: 1` and metres on a right-handed floor plane: `x` increases east, `z` increases north, and `y` is height. Preserve source orientation in `project.sourceOrientation`; normalization shifts minimum x/z to zero but never rotates evidence silently.

## Required base shape

The required collections remain `rooms`, `walls`, `openings`, `furniture`, and `materials`, plus `lighting` and `camera`. Single-level models remain valid without vertical collections; omitted `levelId` means `lower` at elevation 0.

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "project-slug",
    "title": "Concept home",
    "status": "concept",
    "sourceAreaM2": 90,
    "sourceOrientation": "north-up",
    "scale": { "basis": "known-length", "metresPerUnit": 1, "confidence": 0.8 },
    "notes": []
  },
  "rooms": [{ "id": "living", "name": "Living", "polygon": [[0,0],[5,0],[5,4],[0,4]], "height": 2.8, "material": "warm-oak" }],
  "walls": [{ "id": "w1", "from": [0,0], "to": [5,0], "height": 2.8, "thickness": 0.16 }],
  "openings": [{ "id": "d1", "kind": "door", "wallId": "w1", "offset": 0.5, "width": 0.9, "height": 2.1 }],
  "furniture": [{ "id": "sofa", "kind": "sofa", "name": "Sofa", "roomId": "living", "position": [2.5,1.5], "size": [2.2,0.9,0.75], "rotation": 0, "material": "warm-white" }],
  "materials": [{ "id": "warm-oak", "name": "Warm oak", "color": "#c9a77b", "roughness": 0.72 }],
  "lighting": { "mode": "day", "ambient": 1.1, "shadows": true },
  "camera": { "initial": "isometric" }
}
```

## Duplex and vertical-space extensions

All fields below are optional and backward compatible:

- `levels[]`: `id`, `name`, non-negative `elevation`, positive `height`.
- `levelId` and optional `elevation` on rooms, walls, and furniture. An explicit elevation overrides the level elevation.
- `slabs[]`: `id`, `name`, `kind` (`floor` or `bridge`), `levelId`, `polygon`, `elevation`, `thickness`, `material`.
- `voids[]`: `id`, `name`, `roomId`, `polygon`, `bottomElevation`, `height`. `roomId` identifies the lower room owning the opening. A double-height room remains on the lower level; an upper slab must not cover its void polygon.
- `stairs[]`: `id`, `name`, `fromLevelId`, `toLevelId`, plan `start`/`end`, `width`, integer `steps`, total `rise`, and `material`.
- `railings[]`: `id`, `name`, `levelId`, a polyline `points`, `elevation`, `height`, and `material`. Transparent materials may set `opacity` from 0 to 1.
- Walls may set `sectionHidden: true` so the viewer can form a deliberate cutaway without changing evidence geometry.
- `assertions` optionally makes duplex intent machine-verifiable: `singleDoubleHeightRoomId`, `doubleHeightM`, `maxStandardLowerHeight`, `requireUpperSlabExcludesVoid`, `upperCoverageRoomIds`, and `requireStairConnectsLevels`. Validation requires exactly one owned void, rejects overlap with every other lower room and any upper slab, checks ordinary lower-room height and nominated upper-floor coverage, and requires a lower-to-upper stair.
- `presentation.reveal: true` allows the viewer's brief floor-to-height reveal; `revealDurationMs` may be 400–5000 ms. Reduced-motion skips it and the first pointer or wheel interaction stops it.

Normalization scales and shifts all plan coordinates, elevations, heights, slab thicknesses, stair rise/width, and railing dimensions. It records `project.levelAreasM2` and `project.designedFloorAreaM2`. If `sourceAreaM2` exists, `project.areaM2` preserves that source fact rather than counting the added upper floor as original area.

Polygons need at least three non-collinear points. IDs are unique per collection. Every room, material, level, wall, stair, and furniture reference must resolve. Dimensions are finite and positive; colors use six-digit hex. `camera.initial` is `isometric`, `top`, or `interior`.

Older models may contain `camera.segments`. Validation keeps them compatible, but the finished viewer ignores staged camera data.

## Calibration

Prefer a printed dimension over estimated furniture size. Record scale basis, confidence, visible evidence, and uncertainty. If no reliable dimension exists, preserve normalized room relationships, set `basis: "unknown"`, keep `confidence <= 0.35`, and retain `status: "concept"`. Never infer structural walls from a raster plan. Re-run normalization after changing scale, orientation, polygons, openings, room relationships, levels, slabs, voids, stairs, or railings.
