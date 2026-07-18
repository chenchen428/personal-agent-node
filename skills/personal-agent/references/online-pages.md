# Online Pages

Online Pages are complete HTML deliverables published by the Agent. The Pages gallery is an index of those deliverables, not a live renderer or a second content schema.

## Publish Contract

1. Finish the HTML and all supporting CSS, JavaScript, fonts, and images before publishing.
2. Open the final HTML at a stable 1200 x 750 desktop viewport. Wait for fonts and media, select a meaningful first view, and capture a PNG without browser chrome, loading indicators, dialogs, consent overlays, or error states.
3. Open the same final HTML at a stable 750 x 1200 mobile viewport. Verify the responsive mobile layout and capture a second PNG. Do not crop or resize the desktop screenshot into a mobile image.
4. Check both images at gallery size. Each must identify this specific Page and contain no secret or unrelated content.
5. Upload supporting assets with `pa-cli pages upload`. HTML is not accepted by this command.
6. Publish the HTML last with `pa-cli pages publish`. Both screenshots are mandatory and are stored with the Page properties.

```bash
pa-cli pages publish \
  --file index.html \
  --folder stable-page-slug \
  --desktop-thumbnail page-thumbnail-desktop.png \
  --mobile-thumbnail page-thumbnail-mobile.png \
  --title "Page title" \
  --summary "Short gallery summary" \
  --desktop-thumbnail-alt "What the desktop screenshot shows" \
  --mobile-thumbnail-alt "What the mobile screenshot shows" \
  --overwrite \
  --json
```

Use `--private` for an authenticated local Page. Public publishing is an R2 external write and requires the normal authenticated local approval. Do not place credentials, cookies, private URLs, or customer-only data in a public Page or screenshot.

The result includes a stable `pageId`. Use that exact value whenever a task, reply, or Activity needs to reference the Page. After publishing a Page Activity, write the relationship explicitly:

```bash
personal-agent activity upsert \
  --capability <ephemeral> \
  --type page \
  --title "Page published" \
  --detail "The completed Page is ready to open." \
  --target-type page \
  --target-id "<pageId returned by pa-cli pages publish>" \
  --idempotency-key "page:<stable-page-slug>:published" \
  --correlation-key "page:<stable-page-slug>" \
  --json
```

## Link Contract

- Canonical Page records, screenshot URLs, task links, Activity targets, and other system relationships stay as same-origin relative paths. `pa-cli pages publish` exposes that canonical value as `internalUrl` without persisting a tunnel origin.
- When a managed tunnel is available, `pa-cli pages publish` returns `url` as a complete HTTPS address on the current tunnel domain. Use that `url` when reporting a Page through WeChat or another remote channel; the desktop client may convert it to the equivalent local destination.
- When no accessible tunnel domain is configured, `url` is empty and `linkNotice` is `暂未配置可访问的域名链接，无法直接访问页面`. Report that notice; never invent a domain or substitute a local path.
- A local HTML file is not a deliverable link. Never expose a workspace path, Windows drive letter, UNC path, `file://`, `localhost`, `127.0.0.1`, or any URL containing an absolute filesystem path. Publish the Page first.
- `shareUrl` is a separate external address. Use it only when the user explicitly asks for a public share link and remote access is available.
- Never replace the CLI's managed `url` with `shareUrl` or persist a tunnel/domain origin in the canonical Page record.

## Screenshot Rules

- Format: PNG for both screenshots.
- Desktop: 640 x 360 through 4096 x 4096, aspect ratio 1.35 through 1.8; 1200 x 750 is recommended.
- Mobile: 360 x 640 through 2160 x 4096, width/height ratio 0.5 through 0.8; 750 x 1200 is recommended.
- Source: two distinct screenshots of the completed Page selected by the Agent during publishing.
- Storage: both image byte streams and metadata are stored with the Page. Returned screenshot URLs are stable same-origin resources.
- Rendering: desktop clients read `desktopThumbnailUrl`; mobile clients read `mobileThumbnailUrl`. Clients must not load the HTML, run an iframe, capture the page again, or fetch an unrelated external image to build the gallery.

After publishing, verify the result contains `page.pageId`, `page.thumbnails.desktop`, and `page.thumbnails.mobile`, including each file name, dimensions, alt text, and SHA-256. Then check that the Pages list returns the same stored URLs. If either screenshot generation or upload fails, stop the publication and report the failure instead of publishing HTML with one screenshot.
