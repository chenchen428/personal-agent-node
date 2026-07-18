# Getting started

## Install an immutable release

Set `TAG=v0.2.0-beta.20` and open the matching [GitHub Release](https://github.com/chenchen428/personal-agent-node/releases/tag/v0.2.0-beta.20). A customer machine does not need Node.js, npm, Git, a source checkout, or a development Agent.

| Computer | Asset |
| --- | --- |
| Windows x86-64 | `personal-agent-node-v0.2.0-beta.20-windows-x64-installer.exe` |
| macOS Apple Silicon | `personal-agent-node-v0.2.0-beta.20-macos-arm64.pkg` |
| macOS Intel | `personal-agent-node-v0.2.0-beta.20-macos-x64.pkg` |
| Linux x86-64 | `personal-agent-node-v0.2.0-beta.20-linux-x64.tar.zst` |
| Linux ARM64 | `personal-agent-node-v0.2.0-beta.20-linux-arm64.tar.zst` |

On Windows, run the installer and choose the Personal Agent folder; both `core/` and the data-owning `workspace/`, including installation staging, will stay under that selected folder. On macOS, open the package. On Linux, unpack the matching archive with the desktop archive manager or `tar --zstd`, then run `./personal-agent-setup` from the extracted directory.

Each package contains the Go setup executable, stable CLI and desktop launchers, the exact Node.js `22.23.1` runtime, the platform Tauri 2 shell, and the immutable application payload. Setup verifies embedded checksums, stages the release, initializes the Workspace, switches `current` while retaining `previous`, installs the desktop entry, and opens the local Setup Center directly in the shell. Direct loopback desktop access requires no login; tunneled mobile and public-domain access still requires the access password. The shell uses the system WebView, starts the bundled runtime without a terminal, and stops it when the client closes. Windows uses the folder selected during installation; other platforms default to `~/.personal-agent`. Product releases live under `core/`, while Harness, plugins, files, databases, mail and other user-owned state live under `workspace/`.

Release assets include `RELEASE-SECURITY.json`, `SHA256SUMS`, Sigstore bundles, provenance, and an SBOM. Beta/RC packages may defer paid Windows and Apple native signing and can therefore trigger an operating-system approval warning; the security metadata records that fact explicitly. Stable releases require Authenticode plus Apple Developer ID/notarization and fail closed when either is absent.

## Finish setup in the browser

The Personal Agent desktop window opens `/app/setup` automatically. If the shell cannot start, the browser recovery command below opens the same route. Work through the cards in order:

1. Set your own local access password. Only a salted scrypt verifier is retained; the install-time migration password is removed.
2. Install or sign in to Codex when requested, retry the app-server handshake, and complete one real authenticated `/app/chat` reply.
3. Keep `local-only` when no public access is needed, or select Personal Agent Cloud and approve the browser authorization flow.
4. Treat the public domain and Agent mail address as identity checks. Mail becomes operational only after a real local message and recovery check pass.
5. After the required setup is complete, open Connections when you want to add optional WeChat remote access or another external system.

Setup repairs that mutate the machine use a digest-bound R2 plan, an explicit local confirmation, one execution, and a local audit record. Read-only retry and guidance actions do not mutate state.

If the browser does not open, run:

```bash
personal-agent setup open
personal-agent setup status --json
personal-agent doctor --json
```

`setup status` and `doctor` are read-only and return sanitized evidence. They never print setup nonces, passwords, cookies, device codes, tokens, mail content, or conversation content.

## Managed connectivity is optional

The Setup Center starts both purpose-bound browser approvals required by Personal Agent Cloud: Node enrollment and redacted resource access. The long-lived Node credential remains under the mode-600 local secrets directory. Managed remote access uses an outbound application WebSocket and does not install WireGuard or change system proxy, DNS, or routes. Only redacted domain, mailbox, endpoint, and readiness metadata is written to normal configuration.

Advanced operators may still use `personal-agent cloud connect --json`, `personal-agent cloud login --json`, and `personal-agent cloud resources --json`. The managed origin can be overridden with `PERSONAL_AGENT_CLOUD_URL=https://cloud.example`; custom origins must use HTTPS.

## Upgrade and rollback

Running a newer platform package uses the same verified transaction. A failed candidate restores the old `current` pointer. The native recovery command remains available even when Node cannot start:

```bash
personal-agent-setup rollback
```

Rollback changes immutable binaries only. It does not delete the data root. Keep backups before schema-changing upgrades.

## Uninstall

Uninstall requires an explicit binary-removal confirmation. It stops the client-owned runtime and removes the installed program, while preserving the data root by default:

```bash
personal-agent-setup uninstall --confirm-remove-binaries
```

The uninstaller accepts only a directory with a valid Personal Agent `installation.json`, rejects filesystem roots and the user home directory, and refuses layouts where mutable data is nested inside the installation root. Delete the reported data root separately only when you intentionally want to remove local identity, configuration, mail, files, and conversation state.

## Develop from source

Source development uses Node.js `22.23.1`, Go `1.24.x`, and repository compatibility bridges:

```bash
npm install
bash scripts/setup-agent-bridge.sh --force
npm run doctor
npm run guard
npm test
npm run check
```

The bridge command creates ignored development-only links for `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md`. The installed product creates only the canonical workspace and `.codex/skills` bridge.

Final Node acceptance uses the public GitHub Release installation's authenticated local `/app/chat`. Sanitized evidence records `releaseAssetRuntime=true`, `route=/app/chat`, `authenticated=true`, `uniquePrompt=true`, `realAgentRuntime=true`, `sameSessionAgentReply=true`, and `wechatRequired=false`; optional `connections.wechat` evidence never blocks the gate. It stores no prompt, reply, session identifier, QR content, or connection credential.

## Discover CLI capabilities

```bash
personal-agent help --json
personal-agent help --preview --json
personal-agent help --all --json
```

Preview execution requires `--preview` and returns a `PREVIEW_COMMAND` warning. Planned and unknown commands fail closed with `CAPABILITY_UNAVAILABLE`.
