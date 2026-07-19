# Concept model contract

The normalized document uses `schemaVersion: 1` and metres in a right-handed floor plane: `x` increases east, `z` increases north, and `y` is height. Preserve the source orientation in `project.sourceOrientation`; normalization shifts the minimum x/z to zero but does not rotate evidence silently.

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
    "scale": { "basis": "known-length|estimated|unknown", "metresPerUnit": 1, "confidence": 0.5 },
    "notes": []
  },
  "rooms": [{ "id": "living", "name": "Living", "polygon": [[0,0],[5,0],[5,4],[0,4]], "height": 2.8, "material": "warm-oak" }],
  "walls": [{ "id": "w1", "from": [0,0], "to": [5,0], "height": 2.8, "thickness": 0.16 }],
  "openings": [{ "id": "d1", "kind": "door", "wallId": "w1", "offset": 0.5, "width": 0.9, "height": 2.1 }],
  "furniture": [{ "id": "sofa", "kind": "sofa", "name": "Sofa", "roomId": "living", "position": [2.5,1.5], "size": [2.2,0.9,0.75], "rotation": 0, "material": "warm-white" }],
  "materials": [{ "id": "warm-oak", "name": "Warm oak", "color": "#C9A77B", "roughness": 0.72 }],
  "lighting": { "mode": "day", "ambient": 1.1, "shadows": true },
  "camera": { "initial": "isometric", "segments": [
    { "id": "growth", "label": "Build", "durationMs": 6500, "kind": "growth" },
    { "id": "push", "label": "Push", "durationMs": 3500, "kind": "push" },
    { "id": "lateral", "label": "Lateral", "durationMs": 3500, "kind": "lateral" },
    { "id": "detail", "label": "Detail", "durationMs": 3500, "kind": "detail", "targetRoomId": "living" }
  ] }
}
```

Polygons require at least three non-collinear points. IDs are unique per collection. Every furniture `roomId`, opening `wallId`, and camera `targetRoomId` must resolve. Dimensions and durations must be finite and positive. Colors use six-digit hex. Unknown information belongs in `project.notes`, not invented fields.

## Calibration

Prefer a printed dimension over estimated furniture size. Record scale basis and confidence. If no reliable dimension exists, use normalized room relationships, set `basis: "unknown"`, `confidence <= 0.35`, and keep `status: "concept"`. Agent or user calibration may adjust scale, orientation, polygons, openings, or room relationships; re-run normalization after each change.

