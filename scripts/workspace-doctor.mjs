#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, executable, report, root, trackedFiles } from './harness-lib.mjs';

const checks = [];
const nodeMajor = Number(process.versions.node.split('.')[0]);
checks.push({ name: 'Node.js 22.x', ok: nodeMajor >= 22 && nodeMajor < 24, detail: process.version });
for (const file of ['AGENTS.md', 'README.md', 'DESIGN.md', 'docs/adr/0001-node-product-boundary-freeze.md', 'docs/adr/0003-core-workspace-next-architecture.md', 'registry/projects.json', 'registry/delivery.json', 'registry/skills.json', 'registry/agents.json', 'registry/behavior-baselines.json', 'registry/capabilities.json', 'registry/routes.json', 'registry/extensions.json', 'registry/commands.json', 'schemas/personal-agent/agents.schema.json', 'schemas/personal-agent/video-styles.schema.json', 'agents/video-creator/AGENT.md', 'agents/video-creator/STYLE-GUIDE.md', 'agents/video-creator/styles.json', 'agents/interior-designer/AGENT.md', 'agents/interior-designer/agent.yaml', 'agents/travel-planner/AGENT.md', 'agents/travel-planner/agent.yaml', 'agents/poster-designer/AGENT.md', 'agents/poster-designer/agent.yaml', 'agents/finance-analyst/AGENT.md', 'agents/finance-analyst/agent.yaml', 'core/app/public/assets/agent-examples/personal-agent-intro-v1/personal-agent-intro.mp4', 'core/app/public/assets/agent-examples/city-observer-social-cards-v1/xhs-01-cover.png', 'core/app/public/assets/agent-examples/travel-planning-fuzhou-v1/index.html', 'core/app/public/assets/agent-examples/monthly-finance-review-v1/finance-analysis.png', 'workspace/AGENTS.md', 'scripts/project-guard.mjs', 'scripts/architecture-guard.mjs', 'scripts/skill-guard.mjs', 'scripts/agent-guard.mjs', 'scripts/skill-tree.mjs', 'scripts/verify-behavior-baselines.mjs', 'scripts/setup-agent-bridge.sh']) checks.push({ name: `harness file ${file}`, ok: exists(file) });
for (const file of ['scripts/project-guard.mjs', 'scripts/architecture-guard.mjs', 'scripts/skill-guard.mjs', 'scripts/agent-guard.mjs', 'scripts/skill-tree.mjs', 'scripts/setup-agent-bridge.sh']) checks.push({ name: `executable ${file}`, ok: exists(file) && executable(file) });
const installedRelease = exists('release-manifest.json');
if (installedRelease) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
  checks.push({
    name: 'installed release manifest',
    ok: manifest.releaseType === 'personal-agent-node' && manifest.schemaVersion === 2 && Boolean(manifest.releaseId),
    detail: manifest.releaseId || 'invalid release manifest'
  });
  for (const file of [
    'core/runtime/bin/private-site.mjs',
    'core/agent/package.json',
    'scripts/install-private-site-node-release.mjs'
  ]) checks.push({ name: `packaged runtime ${file}`, ok: exists(file) });
} else {
  checks.push({ name: 'development dependencies installed', ok: exists('node_modules'), detail: 'run npm install when missing' });
}
const tracked = trackedFiles();
checks.push({ name: 'no tracked secrets', ok: !tracked.some((file) => file.startsWith('secrets/')) });
checks.push({ name: 'no tracked Agent compatibility links', ok: !tracked.some((file) => /^(?:CLAUDE\.md|\.(?:agents|codex|claude|cursor)\/)/.test(file)) });
checks.push({ name: 'gitignore protects runtime state', ok: ['.local/', 'secrets/', 'node_modules/', 'dist/'].every((line) => fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes(line)) });
try { execFileSync(process.execPath, ['scripts/discover-projects.mjs', 'check'], { cwd: root, stdio: 'pipe' }); checks.push({ name: 'project registry', ok: true }); } catch (error) { checks.push({ name: 'project registry', ok: false, detail: error.stderr?.toString().trim() }); }
try { execFileSync(process.execPath, ['scripts/verify-behavior-baselines.mjs'], { cwd: root, stdio: 'pipe' }); checks.push({ name: 'Phase 0 behavior baselines', ok: true }); } catch (error) { checks.push({ name: 'Phase 0 behavior baselines', ok: false, detail: error.stderr?.toString().trim() }); }
try { execFileSync(process.execPath, ['scripts/architecture-guard.mjs'], { cwd: root, stdio: 'pipe' }); checks.push({ name: 'architecture registries', ok: true }); } catch (error) { checks.push({ name: 'architecture registries', ok: false, detail: error.stdout?.toString().trim() || error.stderr?.toString().trim() }); }
report(checks);
