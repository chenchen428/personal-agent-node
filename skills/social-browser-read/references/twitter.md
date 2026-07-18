# Twitter/X browser connection

Use the product connection name `twitter` for Twitter or X reading.

## Commands

```text
pa-cli connection twitter status --json
pa-cli connection twitter open --json
pa-cli connection twitter search --query <query> --json
pa-cli connection twitter read --url <status-url> --json
pa-cli connection twitter read --tweet-id <id> --json
```

Search text is limited to 240 characters. A read URL must use HTTPS on `x.com` or `twitter.com` and contain one valid status path. `read` returns the visible thread and replies up to the bounded provider limit.

## Output

Search and read return normalized tweets with `id`, `author`, `text`, publication time, engagement values, canonical URL, and validated HTTPS media URLs when present.

If X asks for login, 2FA, CAPTCHA, or risk verification, stop and ask the user to complete it in the opened browser. Never use the executor's post, reply, repost, like, bookmark, follow, direct-message, or arbitrary browser operations.
