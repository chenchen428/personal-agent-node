# ADR 0005: Single Tauri desktop application with an embedded Node backend

Status: Accepted

Date: 2026-07-15

## Context

Personal Agent Node exposes its authenticated, responsive Console at
`http://127.0.0.1:8843/app`. A visible command-line or ordinary browser launch makes the installed
product feel like a development tool rather than a desktop application. Treating that Node runtime
as one installed service and the WebView as a second client also creates a product boundary that
users should not have to understand.

The product needs one user-facing application, one Web Console, one immutable release lifecycle,
and a small platform package. Bundling Chromium or a second Node runtime would violate those
constraints.

## Decision

Ship one Tauri 2 desktop application for Windows, macOS, and Linux. The application package contains
the verified Node runtime and backend payload; those are internal application components, not a
separately installed product or platform service.

The application:

- owns the native window, single-instance activation, embedded Node supervisor lifecycle, gateway
  readiness wait, and navigation policy;
- loads the existing loopback Console and accepts an installer-provided, loopback-only bootstrap
  URL without logging or persisting that URL;
- uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux;
- exposes no Tauri command, plugin permission, or native API to the loopback page;
- opens non-loopback HTTP(S) navigation in the system browser and denies other external schemes;
- starts the bundled Node supervisor without a terminal and passes only the verified install,
  release, and Workspace roots;
- stops the supervisor and its child process tree when the application exits;
- keeps the CLI and default-browser Console only as recovery paths.

The platform installer remains the release root of trust. It installs one desktop application,
initializes the Workspace, removes a legacy platform service when upgrading, and creates one
platform application entry. It does not register a scheduled task, launch agent, or systemd user
service. The desktop and Node runtimes stay in the same immutable release so switching
`current` / `previous` switches the complete application.

Windows packages use a pinned NSIS wizard around the self-verifying Go bootstrap. The wizard owns
visible progress, installation-directory selection, failure guidance, Add/Remove Programs
registration, and the final launch choice. The Go bootstrap remains the cross-platform installation
authority. Stable launchers, installation state, product icons, and shortcuts are committed after
the payload and Workspace preparation pass. Windows installs both Start menu and desktop shortcuts,
and a stale launcher displays a native repair message instead of failing invisibly.

## Consequences

- Rust and Tauri become pinned build dependencies in the native platform jobs.
- Each target is built on its native CI runner and the complete application is included in checksum,
  SBOM, signing, provenance, installation, upgrade, and rollback acceptance.
- Linux packages depend on a compatible system WebKitGTK runtime instead of bundling a browser.
- The compressed desktop-shell increment remains capped at 5 MiB on every platform. The raw
  executable cap is 10 MiB on Windows/macOS and 16 MiB on Linux, where WebKitGTK/GTK linking makes
  the ARM64 executable larger without increasing the downloaded shell by the same amount.
- The NSIS stub adds a small Windows-only wrapper but no browser runtime.
- Visual appearance and browser interaction remain user-owned acceptance. Automated checks cover
  build contracts, URL policy, single-instance behavior, packaging, installation, and lifecycle
  semantics without browser automation.

## Rejected alternatives

- Electron duplicates Chromium and Node and materially increases package size.
- A browser/PWA shortcut is smaller but does not provide a consistently governed desktop entry.
- A second desktop frontend would duplicate the responsive Console and create divergent behavior.
- Keeping a separately registered Node service would expose two product concepts and two lifecycles
  even though users install and operate one application.
