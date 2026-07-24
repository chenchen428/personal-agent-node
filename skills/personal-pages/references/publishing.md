# Online Pages

Online Pages are complete HTML deliverables published by the Agent. The Pages gallery is an index of those deliverables, not a live renderer or a second content schema.

## Template Selection

Template selection is mandatory before creating or redoing a Page:

```bash
pa-cli pages templates list --json
pa-cli pages templates inspect --id <matching-template-id> --json
```

Compare the user's intent with each template's `useWhen` and `matchTerms`. When a template matches, use it and its linked `skill`; preserve every `fixedFramework` item and follow `agentInstructions`, while adapting only the `agentFreedom` areas to the user's materials. Put the selected template ID, linked Skill, `implementation.version`, `implementation.generator`, `implementation.artifactMarker`, full template contract, original user materials, constraints, and acceptance criteria in the child-task execution prompt. Run the registered generator and verify the resulting marker, template ID, and version. Do not merely copy a template's visual style, independently recreate a similar Page, or use its example content as user data.

Interior design, renovation, floor-plan remodeling, home layout, SketchUp, and SU design Page requests must select `interior-design-delivery` and invoke the `interior-design` Skill. If the user has not supplied a floor plan or key measurements, identify the missing evidence before generation; never present the example floor plan as the user's design. Use the generic Page workflow only when no registered template semantically matches.

## Publish Contract

1. Finish the HTML and all supporting CSS, JavaScript, fonts, and images before publishing.
2. Run the template generator's deterministic model, asset, and contract checks. For registered templates, verify the generated artifact marker, template ID, implementation version, and required sections.
3. Do not open a browser, take screenshots, click through the Page, perform visual self-review, or claim that desktop/mobile appearance has passed. Visual and interaction acceptance belongs to the user after publication.
4. Upload supporting assets with `pa-cli pages upload`. HTML is not accepted by this command.
5. Publish the HTML last with `pa-cli pages publish`. If template-generated device thumbnails exist, pass both. Otherwise omit both thumbnail flags and the CLI will generate two distinct device-specific gallery previews without opening a browser.

```bash
pa-cli pages publish \
  --file index.html \
  --folder stable-page-slug \
  --template matching-template-id \
  --title "Page title" \
  --summary "Short gallery summary" \
  --overwrite \
  --json
```

Use `--private` for an authenticated local Page. Public publishing is an R2 external write and requires the normal authenticated local approval. Do not place credentials, cookies, private URLs, or customer-only data in a public Page or gallery preview.

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

- Canonical Page records, thumbnail URLs, task links, Activity targets, and other system relationships stay as same-origin relative paths. `pa-cli pages publish` exposes that canonical value as `internalUrl` without persisting a tunnel origin.
- When a managed tunnel is available, `pa-cli pages publish` returns `url` as a complete HTTPS address on the current tunnel domain. Use that `url` when reporting a Page through WeChat or another remote channel; the desktop client may convert it to the equivalent local destination.
- When no accessible tunnel domain is configured, `url` is empty and `linkNotice` is `暂未配置可访问的域名链接，无法直接访问页面`. Report that notice; never invent a domain or substitute a local path.
- A local HTML file is not a deliverable link. Never expose a workspace path, Windows drive letter, UNC path, `file://`, `localhost`, `127.0.0.1`, or any URL containing an absolute filesystem path. Publish the Page first.
- `shareUrl` is a separate external address. Use it only when the user explicitly asks for a public share link and remote access is available.
- Never replace the CLI's managed `url` with `shareUrl` or persist a tunnel/domain origin in the canonical Page record.

## Gallery Preview Rules

- Format: PNG for both previews.
- Desktop: 640 x 360 through 4096 x 4096, aspect ratio 1.35 through 1.8; 1200 x 750 is recommended.
- Mobile: 360 x 640 through 2160 x 4096, width/height ratio 0.5 through 0.8; 750 x 1200 is recommended.
- Source: a registered template may deterministically export two device previews; otherwise `pa-cli pages publish` generates two distinct title/summary cards. Neither path is visual acceptance.
- Storage: both image byte streams and metadata are stored with the Page. Returned thumbnail URLs are stable same-origin resources.
- Rendering: desktop clients read `desktopThumbnailUrl`; mobile clients read `mobileThumbnailUrl`. Clients must not load the HTML, run an iframe, capture the page again, or fetch an unrelated external image to build the gallery.

After publishing, verify the result contains `page.pageId`, `page.thumbnails.desktop`, and `page.thumbnails.mobile`, including each file name, dimensions, alt text, and SHA-256. Then check through the Page API or CLI result that the Pages list returns the same stored URLs. Do not open the Page for this check. If either thumbnail generation or upload fails, stop the publication and report the failure instead of publishing HTML with one preview.

The final response must mark visual and interaction review as pending user acceptance. Deterministic checks can establish template provenance, file integrity, model constraints, and required markup; they cannot establish that the Page looks good to the user.
