# Concept model contract

Use `schemaVersion: 1` and metres on a right-handed floor plane: `x` increases east, `z` increases north, and `y` is height. Preserve source orientation in `project.sourceOrientation`; normalization shifts minimum x/z to zero but never rotates evidence silently.

## Required shape

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "project-slug",
    "title": "Concept home",
    "status": "concept",
    "areaM2": 90,
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

Polygons need at least three non-collinear points. IDs are unique per collection. Every furniture `roomId` and opening `wallId` must resolve. Dimensions are finite and positive; colors use six-digit hex. `camera.initial` is `isometric`, `top`, or `interior`.

Older models may contain `camera.segments`. Validation keeps them compatible, but the finished viewer ignores staged animation data.

## Calibration

Prefer a printed dimension over estimated furniture size. Record scale basis and confidence. If no reliable dimension exists, preserve normalized room relationships, set `basis: "unknown"`, keep `confidence <= 0.35`, and retain `status: "concept"`. Re-run normalization after changing scale, orientation, polygons, openings, or room relationships.
