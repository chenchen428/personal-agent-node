# GitHub release

Releases use immutable `v<package-version>` tags. The tag must exactly match the root `package.json` version and the worktree must be clean.

1. Run `npm ci`, `npm run doctor`, `npm run guard`, `npm test`, and `npm run check`.
2. Run `node scripts/release-package.mjs --tag vX.Y.Z`.
3. Verify the universal archive, CycloneDX SBOM, release manifest, and `SHA256SUMS` under `dist/releases/vX.Y.Z/`.
4. Push the signed or annotated tag. GitHub Actions repeats every gate and uploads the immutable files to the matching GitHub Release.

Install releases with `scripts/install-private-site-node-release.mjs`. It atomically advances `current`, retains one `previous`, and prunes older inactive releases. Use `npm run release:rollback -- --install-root <path>` to swap `current` and `previous`; restart and acceptance remain the operator's responsibility.

To install directly from a published GitHub Release artifact:

```bash
node scripts/install-from-github-release.mjs --tag v0.1.0-beta.15
personal-agent cloud connect --json
```

The downloader verifies the archive against the Release `SHA256SUMS`, then the embedded installer verifies every packaged file before atomically advancing `current`. The CLI uses a short-lived browser device authorization and consumes a one-time enrollment credential after the signed-in user confirms the administrator-assigned Site. No long-lived Node token is displayed.

## Post-release Node gate

CI artifact smoke is not final runtime evidence. After GitHub publishes the Release, install that exact public asset
with `install-from-github-release.mjs`; do not use the source checkout or the local `dist` archive. Start the
installed runtime, authenticate to its local `/app/chat`, submit a unique prompt to the real Agent runtime and
observe the Agent reply in the same session. Record only this canonical object, without the prompt, reply or
session identifier:

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

Any missing or false required boolean, a different route, a deterministic/mock runner or a reply observed in a
different session fails release/final acceptance. WeChat login, polling and notification are optional and do not
affect this gate.
