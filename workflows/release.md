# GitHub release

Releases use immutable `v<package-version>` tags. The tag must exactly match every workspace package version and the worktree must be clean.

1. Run `npm ci`, `npm run doctor`, `npm run guard`, `npm test`, and `npm run check`.
2. Build the clean immutable Node payload and verify its manifest, checksums, CycloneDX SBOM, and public-surface boundary.
3. On native GitHub runners, fetch Node.js `22.23.1` from `nodejs.org`, verify the upstream checksum, and build the Windows x64, macOS x64/ARM64, and Linux x64/ARM64 packages.
4. Run each embedded Go installer's `inspect` smoke check before packaging.
5. For stable tags, Authenticode-sign Windows, Developer-ID-sign and notarize macOS, and fail closed when signing inputs are missing. For Beta/RC tags, publish an explicit `deferred-prerelease` native-signing status and operating-system warning.
6. Generate `RELEASE-SECURITY.json`, `SHA256SUMS`, keyless Sigstore bundles, and GitHub build provenance for every published byte.
7. Publish the artifacts to the matching GitHub Release only after every platform job succeeds.

The native setup executable owns install, upgrade, rollback, and uninstall. It atomically advances `current`, retains `previous`, activates the per-user service, and opens `/app/setup`. A failed candidate restores the previous pointer and service definition. Rollback never deletes mutable data; uninstall requires `--confirm-remove-binaries` and preserves the data root by default.

For `v0.1.0-beta.23`, the primary customer assets are:

- `personal-agent-node-v0.1.0-beta.23-windows-x64-installer.exe`
- `personal-agent-node-v0.1.0-beta.23-macos-x64.pkg`
- `personal-agent-node-v0.1.0-beta.23-macos-arm64.pkg`
- `personal-agent-node-v0.1.0-beta.23-linux-x64.tar.zst`
- `personal-agent-node-v0.1.0-beta.23-linux-arm64.tar.zst`

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

Any missing required boolean, mock runtime, cross-session reply, undisclosed signing status, missing stable native signature, or unavailable rollback fails release acceptance. A disclosed unsigned prerelease can pass the Beta release gate but never the stable/final native-trust gate. Cloud, public mail, and WeChat remain optional and do not affect the local Web gate.
