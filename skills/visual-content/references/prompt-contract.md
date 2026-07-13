# Raster Prompt Contract

Save each final prompt before generation. Include:

```yaml
---
mode: infographic
filename: 01-infographic-skill-tree.png
aspect_ratio: "3:4"
language: zh-CN
references: []
---
```

Then describe these sections:

1. **Purpose**: what the image must communicate and to whom.
2. **Composition**: focal point, zones, reading order, camera/view, and negative space.
3. **Content**: exact concepts, data, objects, and permitted labels.
4. **Visual system**: rendering, palette, lighting/material, line/shape language, typography role.
5. **Continuity**: recurring subject traits and set-level rules.
6. **Constraints**: aspect ratio, exclusions, legibility, and content that must not be invented.

Use actual source terms and numbers. Avoid adjective piles that do not change composition. When exact text is essential, keep labels short or choose SVG/HTML instead of relying on bitmap typography.
