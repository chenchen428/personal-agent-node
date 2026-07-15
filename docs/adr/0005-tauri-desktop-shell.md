# ADR 0005: Tauri desktop shell over the local Web Console

Status: Accepted

Date: 2026-07-15

## Context

Personal Agent Node already runs as a per-user background service and exposes its authenticated,
responsive Console at `http://127.0.0.1:8843/app`. The platform installer currently opens that
Console in the default browser. A visible command-line or ordinary browser launch makes the
installed product feel like a development tool rather than a desktop application.

The product still needs one Web Console, one Node service, one immutable release lifecycle, and a
small platform package. Bundling Chromium or a second Node runtime would violate those constraints.

## Decision

Ship a Tauri 2 desktop shell for Windows, macOS, and Linux as a platform-specific member of each
immutable Node release.

The shell:

- owns only the native window, single-instance activation, gateway readiness wait, and navigation
  policy;
- loads the existing loopback Console and accepts an installer-provided, loopback-only bootstrap
  URL without logging or persisting that URL;
- uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux;
- exposes no Tauri command, plugin permission, or native API to the loopback page;
- opens non-loopback HTTP(S) navigation in the system browser and denies other external schemes;
- does not start, stop, supervise, update, or roll back the Node service;
- remains optional to recovery: the CLI and default-browser Console entry continue to work.

The existing platform installer remains the release root of trust. It installs the Tauri runtime,
creates the platform application entry, waits for the gateway, and opens the shell with the
single-use Setup Center URL. The runtime stays inside the immutable release so switching
`current` / `previous` also switches the desktop shell.

Windows packages use a pinned NSIS wizard around the self-verifying Go bootstrap. The wizard owns
only visible progress, failure guidance, Add/Remove Programs registration, and the final launch
choice. The Go bootstrap remains the cross-platform installation authority. Stable launchers,
installation state, product icons, and shortcuts are committed only after the candidate service
and gateway pass; failure restores their previous bytes together with the service and release
pointers. Windows installs both Start menu and desktop shortcuts, and a stale launcher displays a
native repair message instead of failing invisibly.

## Consequences

- Rust and Tauri become pinned build dependencies in the native platform jobs.
- Each target is built on its native CI runner and included in checksum, SBOM, signing, provenance,
  installation, upgrade, and rollback acceptance.
- Linux packages depend on a compatible system WebKitGTK runtime instead of bundling a browser.
- The NSIS stub adds a small Windows-only wrapper but no browser or application runtime.
- Visual appearance and browser interaction remain user-owned acceptance. Automated checks cover
  build contracts, URL policy, single-instance behavior, packaging, installation, and lifecycle
  semantics without browser automation.

## Rejected alternatives

- Electron duplicates Chromium and Node and materially increases package size.
- A browser/PWA shortcut is smaller but does not provide a consistently governed desktop entry.
- A second desktop frontend would duplicate the responsive Console and create divergent behavior.
- Moving the Node service into a Tauri sidecar would replace the existing supervision and rollback
  contract without product benefit.
