import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateProfessionalPage } from '../../interior-design/scripts/generate-page-v2.mjs';

export const RENDERER = Object.freeze({ id: 'render-interior-pages', version: 1, requestSchema: 'personal-agent/interior-page-request/v1', outputSchema: 'personal-agent/interior-page-bundle/v1' });
export const REVIEW_TARGETS = Object.freeze([
  { id: 'booklet-desktop', entry: 'index.html', viewport: 'desktop' },
  { id: 'booklet-mobile', entry: 'index.html', viewport: 'mobile-portrait' },
  { id: 'three-d-desktop', entry: '3d/index.html', viewport: 'desktop' },
  { id: 'three-d-mobile-portrait', entry: '3d/index.html', viewport: 'mobile-portrait-forced-landscape' },
  { id: 'three-d-mobile-landscape', entry: '3d/index.html', viewport: 'mobile-landscape-native' },
]);

export function renderInteriorPages({ projectDir, context, output, skillRoot, delivery }) {
  const result = generateProfessionalPage({ projectDir, context, output, skillRoot, delivery });
  const audit = JSON.parse(fs.readFileSync(path.join(output, 'audit.json'), 'utf8'));
  const reviewPlan = { schemaVersion: 1, renderer: RENDERER, revision: audit.revision, status: 'ready-for-agent-review', automaticChecks: { status: 'passed', blockingCount: audit.blockingCount, warningCount: audit.warningCount }, targets: REVIEW_TARGETS, correctionSurface: 'governed-project-data-only', forbiddenSurface: ['index.html', '3d/index.html', 'inline CSS', 'viewer JavaScript'], next: 'Inspect every target, record observations, then run the renderer review command.', visualAcceptance: 'user' };
  const reviewPath = path.join(output, 'agent-review.json');
  fs.writeFileSync(reviewPath, `${JSON.stringify(reviewPlan, null, 2)}\n`, { mode: 0o600 });
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.renderer = RENDERER;
  manifest.agentInspection = { required: true, plan: 'agent-review.json', status: 'ready' };
  manifest.files['agent-review.json'] = fileRecord(reviewPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { ...result, manifest, reviewPlan, totalBytes: directoryBytes(output) };
}

export function evaluateAgentReview(bundle, observations) {
  const plan = JSON.parse(fs.readFileSync(path.join(bundle, 'agent-review.json'), 'utf8'));
  if (plan.renderer?.id !== RENDERER.id || plan.renderer?.version !== RENDERER.version) throw new Error('unsupported renderer review plan');
  if (observations?.schemaVersion !== 1 || observations?.rendererVersion !== 1 || observations?.revision !== plan.revision) throw new Error('Agent review does not match renderer version or project revision');
  if (!Array.isArray(observations.targets) || observations.targets.length !== REVIEW_TARGETS.length) throw new Error('Agent review must contain every target exactly once');
  const byId = new Map(observations.targets.map((target) => [target.id, target]));
  if (byId.size !== observations.targets.length) throw new Error('Agent review contains duplicate targets');
  for (const target of REVIEW_TARGETS) { const observation = byId.get(target.id); if (!observation || !['pass', 'needs-change', 'blocked'].includes(observation.status) || !Array.isArray(observation.observations)) throw new Error(`Agent review target is missing or invalid: ${target.id}`); }
  const blockers = [...byId.values()].filter((target) => target.status !== 'pass');
  return { ok: blockers.length === 0, schemaVersion: 1, renderer: RENDERER, revision: plan.revision, decision: blockers.length ? 'revise-project-data-and-rerender' : 'ready-for-user-review', blockingTargets: blockers.map((target) => target.id), visualAcceptance: 'user' };
}

function fileRecord(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') }; }
function directoryBytes(root) { return fs.readdirSync(root, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? directoryBytes(path.join(root, entry.name)) : fs.statSync(path.join(root, entry.name)).size), 0); }
