# Personal Agent desktop shell

This internal module is the Tauri 2 window for the existing loopback Web Console. It is not a
second product, frontend, service supervisor, updater, or Node sidecar.

The shell starts on a bundled readiness page, waits for `127.0.0.1:8843`, and then navigates to
`/app` or to an installer-provided loopback URL. Only that exact loopback origin stays inside the
window. Other HTTP(S) links open in the system browser, and no Tauri command capability is exposed
to Web content.

Use the repository scripts so the Cargo and npm versions stay aligned:

```bash
npm run desktop:check
npm run desktop:build
```

Visual appearance and browser interaction are accepted by the user. Automated checks cover Rust
unit tests, compilation, URL policy, packaging, and the existing Node route/session contracts.
