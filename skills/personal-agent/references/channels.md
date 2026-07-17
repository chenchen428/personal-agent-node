# Channel connection

Desktop UI and main-Agent conversation are two independent entry points over the same local channel state.

## Desktop client

- WeChat and Xiaohongshu QR codes are generated and displayed inside the authenticated desktop Channels page.
- The client polls the corresponding login session and shows scan, confirmation, verification-code, expiry, and connected states in place.
- Do not redirect the desktop user into the main Agent conversation to finish ordinary QR login.

## Main Agent

Use only public CLI capabilities:

```bash
pa-cli wechat status --json
pa-cli wechat login --json
pa-cli channel status xiaohongshu --json
pa-cli channel login xiaohongshu --json
pa-cli channel login xiaohongshu --execute --json
```

The first Xiaohongshu login command is a no-side-effect plan. Run `--execute` only after explicit user confirmation. The current Agent-managed flow may deliver and monitor the QR through the connected WeChat recipient. Do not print QR base64, session secrets, access tokens, cookies, or internal API details in the conversation.

After a connection attempt, verify with the matching `status --json` command and report only the provider, redacted state, and next user action.
