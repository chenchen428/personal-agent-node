# Generic Page publishing

Page publishing is a runtime contract, not a discoverable Skill or a template product. Generate the governed HTML inside the current Space, then publish it without `--template`:

```bash
pa-cli pages publish \
  --file "<project>/derived/page/index.html" \
  --bundle "<project>/derived/page" \
  --folder "<page-folder>" \
  --title "<title>" \
  --summary "<summary>" \
  --json
```

The command validates the governed directory, uploads every referenced asset through its own bounded file request, and only then publishes `index.html` with relative-path references. CSS, JavaScript, JSON, images, fonts, and other passive assets keep their same-origin paths; the final publish request never embeds their bytes. Omit `--bundle` only when the entry file's parent directory is already the complete bundle. The normal per-file upload limit applies to each asset, not to the sum of the directory, and HTML must not base64-inline large images merely to collapse the Page into one file. Use the returned `pageId`, complete managed HTTPS `url`, or explicit `linkNotice`; never construct a hostname or return a drive path, absolute filesystem path, `file://` URL, or loopback URL.

For gallery media, either provide both governed device previews or omit both. When omitted, the CLI generates distinct desktop and mobile previews without opening a browser. This deterministic preview generation is not visual acceptance. The user-facing result remains pending user acceptance.

Stored Page metadata exposes the two device records as `page.thumbnails.desktop` and `page.thumbnails.mobile`. Desktop clients use the desktop thumbnail and mobile clients use the mobile thumbnail.

Create Page Activity only after publication succeeds:

```bash
personal-agent activity upsert \
  --capability <ephemeral> \
  --type page \
  --title "<result title>" \
  --detail "<user-facing result>" \
  --target-type page \
  --target-id "<pageId returned by pa-cli pages publish>" \
  --idempotency-key "<stable retry key>" \
  --correlation-key "<stable story key>" \
  --json
```

Never use a URL, folder, local path, or guessed client route as the Activity target. Existing historical Page records may retain legacy metadata for read compatibility, but new publications do not write template provenance.

## Specialist workflow progress Pages

The runtime creates and privately publishes the unique mobile-first progress Page before a registered specialist Worker executes. Read the `specialistWorkflowState` supplied with the session and keep its stable `pageId`; do not create a second progress Page.

Use the following commands only when maintaining that Page after a transition, or when exercising the workflow CLI outside a runtime session:

```bash
node scripts/specialist-workflow.mjs page \
  --agent <agent-id> \
  --project-key <project_key> \
  --out-dir <project>/derived/workflow-page

pa-cli pages publish \
  --private \
  --overwrite \
  --file <project>/derived/workflow-page/index.html \
  --folder workflow-<agent-id>-<project_key> \
  --json
```

For a direct CLI exercise, save the real publication JSON and pass it to `specialist-workflow init --progress-publication`. In a runtime session, start from the persisted revision-zero state. After every `advance` or `reopen`, regenerate and overwrite the same Page, then run `specialist-workflow sync --progress-publication`. The next transition fails closed until `publishedRevision` equals the workflow revision.

Use text confirmation only for a stage whose `review.surface` is `text`. For `page`, publish the intermediate artifact privately and pass its exact `pageId`, managed HTTPS or same-origin URL, title and artifact kind in the event. The confirmation must use `surface: page` and the same `pageId`; a URL, local path, guessed ID or different Page is not confirmation.
