# Capture Quality Gate

## Inspect

Check the first and last substantive sections, not just file size. A valid capture should contain the requested subject, coherent paragraphs, and recognizable section boundaries.

Reject or retry captures dominated by:

- sign-in, consent, CAPTCHA, or access-denied text;
- navigation, cookie banners, comments, or related-link grids;
- loading placeholders or empty client-rendered shells;
- search snippets presented as complete content;
- duplicate paragraphs caused by responsive markup.

## Recover

1. Confirm the canonical URL and redirects.
2. Prefer a raw or print-friendly source when the site provides one.
3. Use an authorized browser session for client-rendered or login-gated content.
4. Narrow extraction to the visible article, post, thread, or transcript container.
5. Preserve a partial capture only when it is still useful and clearly label omissions.

## Provenance Header

Use these fields when writing a capture manually:

```yaml
---
title: "Source title"
source_url: "https://requested.example/path"
resolved_url: "https://canonical.example/path"
captured_at: "2026-07-10T00:00:00.000Z"
capture_method: "browser"
---
```

Do not add an author or publication date unless the source explicitly provides it.
