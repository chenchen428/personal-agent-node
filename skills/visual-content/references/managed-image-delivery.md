# Managed image delivery

The completion path is **generate → inspect → iterate if needed → manage → attach → optionally publish**.

1. Save the image and its prompt in the task working area. Record its intended use.
2. Inspect dimensions, media type, crop, text, factual labels, and visual continuity. Iterate before compression or upload.
3. Register the accepted file through an available governed managed-file operation. When it belongs to a Page bundle, `pa-cli pages upload` is the canonical upload path.
4. Verify the returned or resolved `obj_` with the official file status operation. It must belong to the current space and be ready.
5. Record width, height, media type, purpose, and concise alt text alongside the object ID.
6. A Worker reports candidate object IDs only. The main Agent selects them in the final-reply attachment envelope; the connector then sends a native WeChat image. Do not call direct channel send commands from the visual workflow.
7. Publish an HTML report or interactive Page only through `pa-cli pages publish`; retain its stable `pageId` and returned URL or `linkNotice`. A Page link complements rather than replaces a requested native image.

If the installed runtime has no governed ingest operation for a standalone image, report that capability gap. Do not edit a database, invent an object ID, or quietly fall back to a URL.
