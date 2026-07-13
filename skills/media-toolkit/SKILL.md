---
name: media-toolkit
description: Inspect image dimensions and metadata, convert raster formats, and compress images to WebP, PNG, or JPEG with deterministic local tools and measurable size reports. Use when the user asks to 压缩图片, 图片瘦身, convert to WebP/JPEG/PNG, inspect dimensions/aspect ratio, optimize publication assets, or verify generated SVG/raster media before delivery.
---

# Media Toolkit

Use the shared CLI for repeatable media operations. Keep the source by default, write to an explicit output path, and report dimensions plus before/after bytes.

## Inspect

```bash
node skills/media-toolkit/scripts/cli.mjs inspect --input "image.png"
node skills/media-toolkit/scripts/cli.mjs inspect --input "diagram.svg" --json
```

Raster inspection uses ImageMagick. SVG inspection reads declared dimensions and `viewBox`. Check the reported aspect ratio against the target platform before compression.

## Compress Or Convert

```bash
node skills/media-toolkit/scripts/cli.mjs compress \
  --input "image.png" \
  --output "image.webp" \
  --format webp \
  --quality 80
```

Supported output formats are `webp`, `png`, and `jpeg`. WebP prefers `cwebp`; other formats use ImageMagick. The command refuses to overwrite an existing output without `--force` and never overwrites the input path.

Read [references/quality-policy.md](references/quality-policy.md) before optimizing text-heavy, transparent, archival, or already compressed assets.

## Batch Work

For a directory, enumerate intended files first and choose output paths that preserve the relative tree. Run a representative file, inspect it visually, then process the rest. Do not recursively convert unknown directories or delete originals without explicit instruction.

## Completion Contract

Report input/output paths, selected tool, format, quality, dimensions when relevant, byte counts, and reduction percentage. A negative reduction means the new file is larger; keep it only when the format change itself was requested.
