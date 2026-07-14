# Getting started

## Install an immutable release

Personal Agent Node Beta requires Node.js 22.x. On macOS or Linux, install the exact release asset without cloning this repository:

```bash
TAG=v0.1.0-beta.17
INSTALLER="$(mktemp "${TMPDIR:-/tmp}/personal-agent-installer.XXXXXX.mjs")"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$INSTALLER" -- \
  "https://github.com/chenchen428/personal-agent-node/releases/download/$TAG/personal-agent-node-$TAG-installer.mjs"
node "$INSTALLER" --tag "$TAG"
rm -f "$INSTALLER"
export PATH="$HOME/.local/bin:$PATH"
personal-agent doctor --json
```

On Windows PowerShell:

```powershell
$Tag = "v0.1.0-beta.17"
$Installer = Join-Path $env:TEMP "personal-agent-$Tag-installer.mjs"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/chenchen428/personal-agent-node/releases/download/$Tag/personal-agent-node-$Tag-installer.mjs" -OutFile $Installer
node $Installer --tag $Tag
Remove-Item $Installer
& "$env:APPDATA\npm\personal-agent.cmd" doctor --json
```

The installer is a standalone release asset. It downloads the immutable universal archive for the same tag, verifies its SHA256 checksum, activates `current`, retains `previous`, prepares the local data root, and installs a current-following `personal-agent` command shim. The default data root is `~/.personal-agent`; pass `--data-root <path>` to the installer and later CLI commands when using a custom location.

For the managed Free Edge path, register at `https://chenjianhui.site`, wait for an administrator to assign the dedicated domain, and run:

```bash
personal-agent cloud connect --json
```

The CLI opens the short-lived authorization page on `chenjianhui.site` and prints only a user code plus same-origin fallback URL. Sign in with the registered email account, confirm the assigned Site, and return to the terminal. The CLI polls within the advertised expiry, consumes a one-time enrollment credential, enrolls the local device, verifies a heartbeat, and stores the long-lived Node token only in the mode-600 local secret file. It never prints the device code, enrollment credential, token, generated local password, or tunnel secret.

The managed Cloud origin is configurable. `PERSONAL_AGENT_CLOUD_URL=https://cloud.example` changes the default for the current process, while `personal-agent cloud connect --cloud-url https://cloud.example --json` is an explicit per-command override and takes priority over the environment. Custom origins must use HTTPS.

## Develop from source

Install Node.js 22.x, then run:

```bash
npm install
bash scripts/setup-agent-bridge.sh --force
npm run doctor
npm test
```

The bridge command creates ignored local links for `.agents`, `.codex`, `.claude`, `.cursor`, and `CLAUDE.md`. Runtime configuration belongs under `PRIVATE_SITE_DATA_ROOT`; the default local data directory is `~/.personal-agent`.

Personal Agent Node must start in local-only mode without contacting `chenjianhui.site` or any configured Cloud origin. Managed Cloud enrollment is an optional provider selected explicitly by the user. Fresh release installs and upgrades provision a missing local mail-ingress token, render current-following CLI shims, and non-destructively copy legacy `mail-ingress/` data into `mail/` while retaining the old source for rollback.

Final Node acceptance uses the GitHub Release installation's authenticated local `/app/chat`: send a unique prompt to the real Agent runtime and verify the Agent reply in the same session. Canonical evidence records `releaseAssetRuntime=true`, `route=/app/chat`, `authenticated=true`, `uniquePrompt=true`, `realAgentRuntime=true`, `sameSessionAgentReply=true`, and `wechatRequired=false`; it stores no prompt, reply or session identifier.

## Discover CLI capabilities

The public CLI reports capability maturity instead of presenting roadmap commands as available:

```bash
personal-agent help --json           # implemented commands only
personal-agent help --preview --json # implemented and preview commands
personal-agent help --all --json     # implemented, preview, and planned metadata
personal-agent cloud connect --help --json # exact browser-authorization options and secret boundary
```

Preview execution requires an explicit `--preview` flag and returns a `PREVIEW_COMMAND` warning. `--all` works only with help and never enables planned commands. Planned and unknown commands fail closed with `CAPABILITY_UNAVAILABLE`.
