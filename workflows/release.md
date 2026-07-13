# GitHub release

Releases use immutable `v<package-version>` tags. The tag must exactly match the root `package.json` version and the worktree must be clean.

1. Run `npm ci`, `npm run doctor`, `npm run guard`, `npm test`, and `npm run check`.
2. Run `node scripts/release-package.mjs --tag vX.Y.Z`.
3. Verify the universal archive, CycloneDX SBOM, release manifest, and `SHA256SUMS` under `dist/releases/vX.Y.Z/`.
4. Push the signed or annotated tag. GitHub Actions repeats every gate and uploads the immutable files to the matching GitHub Release.

Install releases with `scripts/install-private-site-node-release.mjs`. It atomically advances `current`, retains one `previous`, and prunes older inactive releases. Use `npm run release:rollback -- --install-root <path>` to swap `current` and `previous`; restart and acceptance remain the operator's responsibility.
