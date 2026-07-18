# Xiaohongshu browser connection

Use the product connection name `xiaohongshu` for 小红书 or RedNote reading.

## Commands

```text
pa-cli connection xiaohongshu status --json
pa-cli connection xiaohongshu open --json
pa-cli connection xiaohongshu search --keyword <query> --json
pa-cli connection xiaohongshu read --url <signed-note-url> --json
```

Prefer the full signed URL returned by `search`. The compatibility form below is accepted only for an immediately preceding result:

```text
pa-cli connection xiaohongshu read --feed-id <id> --xsec-token <token> --json
```

Search text is limited to 80 characters. A read URL must use HTTPS on a Xiaohongshu host, point to a supported note path, and contain `xsec_token`.

## Output

Search returns normalized `feeds` with `id`, `title`, `author`, engagement fields, publication time, and the signed source `url`. Read returns `detail` plus the normalized note identity and source URL.

Use source URLs only for the current task. Do not persist or reproduce `xsec_token` unless the user explicitly needs the link itself. If the platform asks for login, CAPTCHA, SMS, QR, or risk verification, stop and ask the user to complete it in the opened browser.
