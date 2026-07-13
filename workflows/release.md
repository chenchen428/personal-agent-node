# GitHub release

Releases use immutable `v<package-version>` tags. The tag must exactly match the root `package.json` version and the worktree must be clean.

1. Run `npm ci`, `npm run doctor`, `npm run guard`, `npm test`, and `npm run check`.
2. Run `node scripts/release-package.mjs --tag vX.Y.Z`.
3. Verify the universal archive, CycloneDX SBOM, release manifest, and `SHA256SUMS` under `dist/releases/vX.Y.Z/`.
4. Push the signed or annotated tag. GitHub Actions repeats every gate and uploads the immutable files to the matching GitHub Release.

Install releases with `scripts/install-private-site-node-release.mjs`. It atomically advances `current`, retains one `previous`, and prunes older inactive releases. Use `npm run release:rollback -- --install-root <path>` to swap `current` and `previous`; restart and acceptance remain the operator's responsibility.

To install directly from a published GitHub Release artifact:

```bash
node scripts/install-from-github-release.mjs --tag v0.1.0-beta.1
node ~/.private-site-node/current/projects/core/node/bin/private-site.mjs onboarding
```

The downloader verifies the archive against the Release `SHA256SUMS`, then the embedded installer verifies every packaged file before atomically advancing `current`. The onboarding page is available at `http://127.0.0.1:8842/` and accepts the Cloud email, authorization code, and slug.
