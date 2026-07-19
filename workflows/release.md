# GitHub release

Releases use immutable `v<package-version>` tags. The tag must exactly match every workspace package version and the worktree must be clean.

1. Run `npm ci`, `npm run doctor`, `npm run guard`, `npm test`, and `npm run check`.
2. Build the clean immutable Node payload and verify its manifest, checksums, CycloneDX SBOM, and public-surface boundary.
3. On native GitHub runners, fetch Node.js `22.23.1` from `nodejs.org`, verify the upstream checksum, and build the Windows x64, macOS x64/ARM64, and Linux x64/ARM64 packages.
4. Run each embedded Go installer's `inspect` smoke check before packaging, then publish the same self-contained executable as a platform-specific `-updater` asset for the in-client update path.
5. For stable tags, Authenticode-sign Windows, Developer-ID-sign and notarize macOS, and fail closed when signing inputs are missing. For Beta/RC tags, publish an explicit `deferred-prerelease` native-signing status and operating-system warning.
6. Generate `RELEASE-SECURITY.json`, CycloneDX SBOM and keyless Sigstore bundles as the retained `release-evidence` CI artifact; attach GitHub build provenance to every customer asset.
7. Publish only the five customer installers, five machine-consumed update executors and one consolidated `SHA256SUMS` to the matching GitHub Release after every platform job succeeds. Do not flatten internal manifests, SBOMs, individual `.sha256` files or Sigstore bundles into the customer download list.
8. After publication, create a least-privilege GitHub App token scoped only to the private `chenchen428/personal-agent` repository, dispatch `node-release-published`, and wait for its `Node Release Download Sync` workflow to succeed. Configure `CLOUD_SYNC_GITHUB_APP_ID` and `CLOUD_SYNC_GITHUB_APP_PRIVATE_KEY` as Node repository secrets. The release run stays red when dispatch fails, the private workflow cannot verify all installers, or `https://personal-agent.cn/download` does not converge to the exact tag and asset links.

The native setup executable owns install, upgrade, rollback, and uninstall. It atomically advances `current`, retains `previous`, installs the desktop entry, and opens `/app/setup`. The desktop client starts the local runtime and stops it on exit. A failed candidate restores the previous pointer. Rollback never deletes mutable data; uninstall requires `--confirm-remove-binaries` and preserves the data root by default.

The Console and main Agent discover only matching GitHub Release updater assets and verify their exact `SHA256SUMS` entry before staging. Ordinary user-initiated apply and rollback use an R3 digest-bound local approval. In the registered, authenticated Owner-initiated product-development flow, the request is standing authorization for the exact digest-bound plan: use `--product-development` and do not pause for a second local confirmation. The Tauri shell validates the owner-only update job, stops the old runtime, starts the candidate executor, and exits; the executor relaunches `/app/update` and records the post-restart outcome.

For `v0.1.0-beta.24`, the primary customer assets are:

- `personal-agent-node-v0.1.0-beta.24-windows-x64-installer.exe`
- `personal-agent-node-v0.1.0-beta.24-macos-x64.pkg`
- `personal-agent-node-v0.1.0-beta.24-macos-arm64.pkg`
- `personal-agent-node-v0.1.0-beta.24-linux-x64.tar.zst`
- `personal-agent-node-v0.1.0-beta.24-linux-arm64.tar.zst`

The matching `-updater` files are machine-consumed by the client update flow. A normal user chooses only the installer for their operating system. `SHA256SUMS` is the single human-visible verification file; detailed supply-chain evidence remains available from the release workflow run and GitHub provenance attestation.

## Post-release Node gate

CI smoke tests are not final runtime evidence. Install the exact public asset on a fresh customer-like machine without a source checkout, host Node.js, or development Agent. Verify restart, authenticated `/app/setup`, durable local auth, and a real Codex reply in the same authenticated `/app/chat` session.

Record only the canonical sanitized object, without prompt, reply, or session identifier:

```json
{
  "releaseAssetRuntime": true,
  "route": "/app/chat",
  "authenticated": true,
  "uniquePrompt": true,
  "realAgentRuntime": true,
  "sameSessionAgentReply": true,
  "wechatRequired": false
}
```

Any missing required boolean, mock runtime, cross-session reply, undisclosed signing status, missing stable native signature, or unavailable rollback fails release acceptance. A disclosed unsigned prerelease can pass the Beta release gate but never the stable/final native-trust gate. Cloud, public mail, and WeChat remain optional connections; the independent local Web conversation is the required Agent gate.
