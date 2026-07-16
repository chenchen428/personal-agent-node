# ADR 0005: Tauri desktop shell over the local Web Console

Status: Accepted

Date: 2026-07-15

## Context

Personal Agent Node exposes its responsive Console at
`http://127.0.0.1:8843/app`. The installed product must behave as one desktop application:
opening the client starts the local runtime and closing the client stops it. A visible
command-line or ordinary browser launch makes the installed product feel like a development tool
rather than a desktop application.

The product still needs one Web Console, one Node service, one immutable release lifecycle, and a
small platform package. Bundling Chromium or a second Node runtime would violate those constraints.

## Decision

Ship a Tauri 2 desktop shell for Windows, macOS, and Linux as a platform-specific member of each
immutable Node release.

The shell:

- owns the native window, single-instance activation, local runtime start/stop, gateway readiness
  wait, and navigation policy;
- loads the existing loopback Console directly without login or an installer bootstrap session;
- keeps password authentication on tunneled or public-domain requests and exposes password reset
  only to the direct loopback System Settings route;
- uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux;
- exposes no Tauri command, plugin permission, or native API to the loopback page;
- opens non-loopback HTTP(S) navigation in the system browser and denies other external schemes;
- starts the existing bundled Node runtime without a terminal when the first client instance opens;
- stops the Agent, Console, mail intake, automations, and tunnel when that client exits;
- does not implement runtime supervision, update, or rollback itself;
- keeps browser and CLI access available while the client-owned runtime is running.

The existing platform installer remains the release root of trust. It installs the Tauri runtime,
creates the platform application entry, and opens the shell directly at the local Setup Center.
The shell starts the runtime and waits for the gateway. Both stay inside the immutable release so
switching `current` / `previous` switches the desktop shell and runtime together.

## Consequences

- Rust and Tauri become pinned build dependencies in the native platform jobs.
- Each target is built on its native CI runner and included in checksum, SBOM, signing, provenance,
  installation, upgrade, and rollback acceptance.
- Linux packages depend on a compatible system WebKitGTK runtime instead of bundling a browser.
- Visual appearance and browser interaction remain user-owned acceptance. Automated checks cover
  build contracts, URL policy, single-instance behavior, packaging, installation, and lifecycle
  semantics without browser automation.

## Rejected alternatives

- Electron duplicates Chromium and Node and materially increases package size.
- A browser/PWA shortcut is smaller but does not provide a consistently governed desktop entry.
- A second desktop frontend would duplicate the responsive Console and create divergent behavior.
- Registering an always-on operating-system service would keep Agent, mail, and the mobile entry
  running after the user closes the client, which conflicts with the approved lifecycle.
