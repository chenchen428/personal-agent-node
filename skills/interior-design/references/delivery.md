# Governed delivery

Use `$visual-content` for raster generation and inspection, `$media-toolkit` for deterministic media QA, and `$personal-agent` for files, Pages, and final attachments. Reuse their capabilities; do not duplicate model-provider calls or connector sends in this Skill.

## Image contract

1. Generate to a local working file and inspect dimensions/content.
2. Iterate when plan continuity, crop, material, or text fails.
3. Register the accepted file through an available governed managed-file or Page upload operation.
4. Verify the resulting `obj_` belongs to the current space and is `ready`.
5. Record purpose, width, height, media type, and concise alt text.
6. The main Agent selects it in the final attachment envelope so WeChat can send a native image. Do not substitute a URL by default, and do not call a channel send command from a Worker.

## Page contract

Generate with the registered `interior-design-delivery` command, pass the redacted user floor plan through `--source-plan`, and require its deterministic template verification result. Publish `index.html` with `pa-cli pages publish --file <page-dir>/index.html --folder <stable-folder> --template interior-design-delivery --title <title> --summary <summary> --private --json`. The publish CLI creates distinct device gallery previews when explicit thumbnails are omitted, so the Agent must not open a browser or take screenshots. Retain the stable returned `pageId`; return only its `url` or `linkNotice`, never a guessed hostname or localhost link. Mark visual and interaction review as pending user acceptance.
