# Generic Page publishing

Page publishing is a runtime contract, not a discoverable Skill or a template product. Generate the governed HTML inside the current Space, then publish it without `--template`:

```bash
pa-cli pages publish \
  --file "<project>/derived/page/index.html" \
  --folder "<page-folder>" \
  --title "<title>" \
  --summary "<summary>" \
  --json
```

The command validates the governed input and stores the exact Page artifact hash. Canonical records keep same-origin relative paths. Use the returned `pageId`, complete managed HTTPS `url`, or explicit `linkNotice`; never construct a hostname or return a drive path, absolute filesystem path, `file://` URL, or loopback URL.

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
