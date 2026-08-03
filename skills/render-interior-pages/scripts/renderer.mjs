import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateWorkspacePages } from '../../interior-design/scripts/generate-pages-v5.mjs';
import { refreshWorkspaceManifest } from '../../interior-design/scripts/workspace-v5.mjs';

export const RENDERER = Object.freeze({ id: 'render-interior-pages', version: 5, requestSchema: 'personal-agent/interior-workspace/v5', outputSchema: 'personal-agent/interior-page-bundle/v5' });
export const REVIEW_TARGETS = Object.freeze([
  { id: 'booklet-desktop', entry: 'index.html', viewport: 'desktop' },
  { id: 'booklet-mobile', entry: 'index.html', viewport: 'mobile-portrait' },
  { id: 'online-drawing-desktop', entry: 'index.html#drawings', viewport: 'desktop' },
  { id: 'online-drawing-mobile', entry: 'index.html#drawings', viewport: 'mobile-portrait' },
  { id: 'three-d-desktop', entry: '3d/index.html', viewport: 'desktop' },
  { id: 'three-d-mobile-portrait', entry: '3d/index.html', viewport: 'mobile-portrait' },
  { id: 'three-d-mobile-landscape', entry: '3d/index.html', viewport: 'mobile-landscape-native' },
]);

export function renderInteriorPages({ projectDir, context, output, skillRoot, delivery }) {
  const result = generateWorkspacePages({ projectDir, context, output, skillRoot, delivery });
  const audit = JSON.parse(fs.readFileSync(path.join(output, 'audit.json'), 'utf8'));
  const styleGuide = JSON.parse(fs.readFileSync(path.join(output, 'style-guide.json'), 'utf8'));
  const reviewPlan = { schemaVersion: 5, renderer: RENDERER, revision: audit.revision, status: 'ready-for-agent-review', automaticChecks: { status: 'passed', errorCount: audit.counts.error, holdCount: audit.counts.hold, warningCount: audit.counts.warning }, targets: REVIEW_TARGETS, styleInspection: { required: true, guide: 'style-guide.json', selectedStyleId: styleGuide.selected.id, pagePresentation: 'owner-decision-booklet-v5', correctionSurface: 'project.json + geometry.json + artifact-workflow.json' }, shareableOutputs: ['Owner-Page', 'Online-SVG', 'Semantic-Web3D', 'Krpano-Tour'], correctionSurface: 'dependency-aware-artifacts', forbiddenSurface: ['generated HTML', 'generated CSS', 'viewer bundle'], next: 'Inspect every target and interaction, then confirm or modify the corresponding artifact.', visualAcceptance: 'user' };
  const reviewPath = path.join(output, 'agent-review.json');
  fs.writeFileSync(reviewPath, `${JSON.stringify(reviewPlan, null, 2)}\n`, { mode: 0o600 });
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.renderer = RENDERER;
  manifest.agentInspection = { required: true, plan: 'agent-review.json', status: 'ready' };
  manifest.files['agent-review.json'] = fileRecord(reviewPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  refreshWorkspaceManifest(projectDir);
  return { ...result, manifest, reviewPlan, totalBytes: directoryBytes(output) };
}

export function evaluateAgentReview(bundle, observations) {
  const plan = JSON.parse(fs.readFileSync(path.join(bundle, 'agent-review.json'), 'utf8'));
  if (plan.renderer?.id !== RENDERER.id || plan.renderer?.version !== RENDERER.version) throw new Error('unsupported renderer review plan');
  if (observations?.schemaVersion !== 5 || observations?.rendererVersion !== 5 || observations?.revision !== plan.revision) throw new Error('Agent review does not match renderer version or project revision');
  if (observations?.style?.selectedStyleId !== plan.styleInspection?.selectedStyleId
    || observations?.style?.effectRenderBindingReady !== true
    || !Array.isArray(observations?.style?.observations)) throw new Error('Agent review must verify style binding and style guide');
  if (!Array.isArray(observations.targets) || observations.targets.length !== REVIEW_TARGETS.length) throw new Error('Agent review must contain every target exactly once');
  const byId = new Map(observations.targets.map((target) => [target.id, target]));
  if (byId.size !== observations.targets.length) throw new Error('Agent review contains duplicate targets');
  for (const target of REVIEW_TARGETS) { const observation = byId.get(target.id); if (!observation || !['pass', 'needs-change', 'blocked'].includes(observation.status) || !Array.isArray(observation.observations)) throw new Error(`Agent review target is missing or invalid: ${target.id}`); }
  const blockers = [...byId.values()].filter((target) => target.status !== 'pass');
  return { ok: blockers.length === 0, schemaVersion: 5, renderer: RENDERER, revision: plan.revision, decision: blockers.length ? 'modify-affected-artifact-and-invalidate-descendants' : 'ready-for-user-review', blockingTargets: blockers.map((target) => target.id), style: { selectedStyleId: plan.styleInspection.selectedStyleId, guide: plan.styleInspection.guide, effectRenderBindingReady: true, feedbackAction: 'dependency-aware-revision' }, shareableOutputs: plan.shareableOutputs, visualAcceptance: 'user' };
}

function fileRecord(file) { const value = fs.readFileSync(file); return { bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') }; }
function directoryBytes(root) { return fs.readdirSync(root, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? directoryBytes(path.join(root, entry.name)) : fs.statSync(path.join(root, entry.name)).size), 0); }
