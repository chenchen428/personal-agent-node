import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { loadInteriorEnginePolicy } from '../skills/interior-design/scripts/engine-policy.mjs';
import { calculateOrthographicZoom } from '../skills/interior-design/scripts/pascal-camera-framing.mjs';
import {
  calculateForcedLandscapeOrbit,
  calculateForcedLandscapeWheelScale,
  calculatePinchScale,
  mapForcedLandscapeDrag,
  resolveLandscapeCameraInput,
} from '../skills/interior-design/scripts/pascal-landscape-gesture.mjs';
import { generateProfessionalPage, verifyProfessionalPageHtml } from '../skills/interior-design/scripts/generate-page-v2.mjs';
import { loadInteriorDeliveryContract, loadSourcePlanAsset } from '../skills/interior-design/scripts/page-assets.mjs';
import { loadPascalRuntimeModule, PascalInteriorAdapter } from '../skills/interior-design/scripts/pascal-adapter.mjs';
import {
  createProjectFromSeed,
  initializeProject,
  readProject,
  recordProjectAuditEvent,
  recoverProjectRevision,
  resolveProjectDirectory,
  sha256,
  validateProjectV2,
  writeProjectRevision,
} from '../skills/interior-design/scripts/project-v2.mjs';
import { auditProfessionalProject } from '../skills/interior-design/scripts/quality/index.mjs';
import {
  applySceneOperations,
  compileProjectScene,
  redoProjectRevision,
  undoProjectRevision,
} from '../skills/interior-design/scripts/scene-v2.mjs';

const root = path.resolve(import.meta.dirname, '..');
const skillRoot = path.join(root, 'skills/interior-design');
const exampleRoot = path.join(root, 'skills/interior-design/examples/professional-agent-example');
const sourcePlanPath = path.join(exampleRoot, 'source-plan.png');
const annotationPath = path.join(exampleRoot, 'agent-annotation.png');
const renderPromptSet = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'render-prompts.json'), 'utf8'));
const nativeSeedPath = path.join(exampleRoot, 'seed.json');
const nativeSeed = JSON.parse(fs.readFileSync(nativeSeedPath, 'utf8'));

test('fits the orthographic floor plan to the available viewport', () => {
  const projectCamera = fs.readFileSync(
    path.join(root, 'skills/interior-design/scripts/pascal-project-camera.jsx'),
    'utf8',
  );
  assert.equal(calculateOrthographicZoom({
    boundsWidth: 15,
    boundsDepth: 15,
    viewportWidth: 2048,
    viewportHeight: 1152,
  }), 53.76);
  assert.equal(calculateOrthographicZoom({
    boundsWidth: 18,
    boundsDepth: 10,
    viewportWidth: 1200,
    viewportHeight: 800,
  }), 46.666666666666664);
  assert.equal(calculateOrthographicZoom({
    boundsWidth: 0,
    boundsDepth: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  }), 0.7);
  assert.match(projectCamera, /calculateOrthographicZoom/);
  assert.match(projectCamera, /api\.zoomTo\(zoom, false\)/);
});

test('maps portrait-device gestures into the forced-landscape camera axes', () => {
  assert.equal(resolveLandscapeCameraInput('forced-landscape'), 'landscape-mapped');
  assert.equal(resolveLandscapeCameraInput('landscape'), 'native');
  assert.equal(resolveLandscapeCameraInput('desktop'), 'native');
  assert.deepEqual(mapForcedLandscapeDrag(0, 24), { x: -24, y: 0 });
  assert.deepEqual(mapForcedLandscapeDrag(24, 0), { x: 0, y: 24 });
  const orbit = calculateForcedLandscapeOrbit({
    deltaX: 30,
    deltaY: 60,
    viewportHeight: 300,
    azimuthSpeed: 1,
    polarSpeed: 0.5,
  });
  assert.equal(orbit.azimuth, -Math.PI * 0.4);
  assert.equal(orbit.polar, Math.PI * 0.1);
  assert.equal(calculatePinchScale(100, 120), 1.2);
  assert.equal(calculatePinchScale(0, 120), 1);
  assert.equal(calculatePinchScale(100, 200), 1.35);
  assert.ok(calculateForcedLandscapeWheelScale(100) > 1);
  assert.ok(calculateForcedLandscapeWheelScale(-100) < 1);
});

test('requires Pascal v2 as the only interior-design engine and rejects removed engine paths', () => {
  const current = loadInteriorEnginePolicy({ env: {} });
  assert.equal(current.configuredEngine, 'pascal-v2');
  assert.equal(current.creationPolicy, 'pascal-v2-required');
  assert.throws(
    () => loadInteriorEnginePolicy({ env: { PERSONAL_AGENT_INTERIOR_DESIGN_ENGINE: 'unsupported-engine' } }),
    (error) => error.code === 'INTERIOR_ENGINE_INVALID',
  );
  const harness = makeHarness('single-engine');
  assert.equal(readProject(harness.projectDir, harness.context).project.provenance.interiorDesignEngine, 'pascal-v2');
  const cli = path.join(skillRoot, 'scripts/cli.mjs');
  const removedResult = spawnSync(process.execPath, [cli, 'validate', '--input', nativeSeedPath, '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(removedResult.status, 0, removedResult.stderr);
  assert.match(removedResult.stdout, /Usage:/);
  assert.equal(removedResult.stdout, [
    'Usage:',
    '  interior project <init|validate|audit|recover> --project-dir <space-project-dir>',
    '  Workflow: use scripts/specialist-workflow.mjs --agent interior-designer (Page-led v2 contract)',
    '  interior scene <compile|apply|undo|redo> --project-dir <space-project-dir> --base-revision <n>',
    '  interior page --project-dir <space-project-dir> --output <project-derived-page-dir>',
    '',
  ].join('\n'));
  const retiredWorkflow = spawnSync(process.execPath, [cli, 'workflow', 'advance'], { encoding: 'utf8', env: process.env });
  assert.equal(retiredWorkflow.status, 2);
  assert.match(retiredWorkflow.stdout, /LEGACY_WORKFLOW_RETIRED/);
  assert.match(retiredWorkflow.stdout, /specialist-workflow\.mjs/);
});

test('ships a pinned, hash-verified Pascal runtime that works in-process without Bun or vision tools', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'assets/pascal-runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.packages['@pascal-app/core'].version, '0.9.2');
  assert.equal(manifest.packages['@pascal-app/viewer'].version, '0.9.2');
  assert.equal(manifest.packages['@pascal-app/mcp'].version, '0.3.2');
  assert.equal(manifest.policies.transport, 'in-memory-only');
  assert.equal(manifest.policies.bunRequired, false);
  for (const [name, artifact] of Object.entries(manifest.artifacts)) {
    const bytes = fs.readFileSync(path.join(skillRoot, 'assets', name));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  }
  const runtimeModule = await loadPascalRuntimeModule();
  assert.doesNotThrow(() => runtimeModule.validatePersonalAgentArguments('create_wall', {
    levelId: 'level-ground',
    start: [0, 0],
    end: [4, 0],
    height: 2.8,
    thickness: 0.18,
  }));
  assert.throws(() => runtimeModule.validatePersonalAgentArguments('apply_patch', JSON.parse('{"__proto__":{}}')), /forbidden key/);
  assert.throws(() => runtimeModule.validatePersonalAgentArguments('apply_patch', {
    patches: [{ op: 'update', id: 'wall', data: { textureUrl: 'https://remote.invalid/material' } }],
  }), /forbidden asset/);
  const runtime = await runtimeModule.createPascalRuntime({ projectId: 'runtime-test', ownerId: 'owner-test' });
  try {
    const scene = await runtime.call('get_scene');
    assert.ok(Object.values(scene.nodes).some((node) => node.type === 'level'));
    assert.equal((await runtime.call('validate_scene')).valid, true);
    assert.equal(runtime.allowedTools.some((name) => /vision|image|photo/i.test(name)), false);
    await assert.rejects(runtime.call('sample_image', {}), /not allowed/);
  } finally {
    await runtime.close();
  }
  assert.doesNotMatch(fs.readFileSync(path.join(skillRoot, 'assets/pascal-headless.bundle'), 'utf8'), /bun:sqlite/);
});

test('governs native v2 project directories, ownership, symlinks, and SQLite identity', () => {
  const harness = makeHarness('security');
  const before = sha256(fs.readFileSync(nativeSeedPath));
  assert.equal(readProject(harness.projectDir, harness.context).project.schemaVersion, 2);
  assert.equal(fs.existsSync(path.join(harness.projectDir, '.runtime/pascal.db')), true);
  assert.equal(sha256(fs.readFileSync(nativeSeedPath)), before);
  const auditEvent = recordProjectAuditEvent(harness.projectDir, harness.context, {
    projectId: readProject(harness.projectDir, harness.context).project.projectId,
    revision: 1,
    command: 'project validate',
    result: 'ok',
    durationMs: 12.4,
    hashes: { inputHash: before },
    timestamp: '2026-07-27T00:00:01.000Z',
  });
  assert.equal(auditEvent.durationMs, 12);
  const auditLogPath = path.join(harness.projectDir, '.runtime', 'audit.ndjson');
  const auditLine = fs.readFileSync(auditLogPath, 'utf8');
  assert.doesNotMatch(auditLine, /\/tmp\/|seed\.json|source-plan/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(auditLogPath).mode & 0o777, 0o600);
  assert.throws(() => resolveProjectDirectory(path.join(harness.spaceRoot, 'outside'), harness.context), /projects directory/);
  assert.throws(() => readProject(harness.projectDir, { ...harness.context, spaceId: 'another-space' }), /trusted Space/);

  const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-interior-escape-'));
  const symlink = path.join(harness.spaceRoot, 'projects', 'home-renovation-symlink');
  fs.symlinkSync(escapeTarget, symlink, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveProjectDirectory(symlink, harness.context), /symbolic links/);

  const database = new DatabaseSync(path.join(harness.projectDir, '.runtime/pascal.db'));
  database.prepare("UPDATE metadata SET value = '999' WHERE key = 'schema_version'").run();
  database.close();
  assert.throws(() => readProject(harness.projectDir, harness.context), /schema 999 is unsupported/);

  const runtimeSymlinkHarness = makeHarness('runtime-symlink');
  const externalRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-interior-runtime-'));
  fs.rmSync(path.join(runtimeSymlinkHarness.projectDir, '.runtime'), { recursive: true });
  fs.symlinkSync(externalRuntime, path.join(runtimeSymlinkHarness.projectDir, '.runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readProject(runtimeSymlinkHarness.projectDir, runtimeSymlinkHarness.context), /runtime directory.*symbolic link/);
});

test('compiles deterministic single-level Pascal scenes with real doors, windows, and stable mappings', async () => {
  const harness = makeHarness('deterministic');
  const project = readProject(harness.projectDir, harness.context).project;
  const adapter = new PascalInteriorAdapter();
  const first = await adapter.compileScene(project);
  const second = await adapter.compileScene(structuredClone(project));
  assert.deepEqual(first.modelBasis, {
    evidenceId: project.provenance.sourcePlanEvidenceId,
    sha256: project.provenance.sourcePlanSha256,
  });
  assert.equal(first.sceneHash, second.sceneHash);
  assert.deepEqual(first.scene, second.scene);
  assert.deepEqual(first.furniture, second.furniture);
  assert.equal(first.designQuality.materials.length, 6);
  assert.equal(first.designQuality.lights.length, 3);
  assert.equal(first.designQuality.cameras.length, 3);
  assert.equal(first.designQuality.rendering.geometryLocked, true);
  assert.ok(first.furniture.every((item) => item.assetProfile?.assetId && item.materialId));
  const types = Object.values(first.scene.nodes).map((node) => node.type);
  assert.ok(types.includes('door'));
  assert.ok(types.includes('window'));
  assert.ok(types.includes('slab'));
  assert.ok(types.includes('ceiling'));
  assert.ok(first.mappings.entry);
  assert.ok(first.mappings['north-window']);
  assert.ok(first.mappings.sofa);
  assert.equal((await adapter.queryScene({ snapshot: first, sourceIds: ['entry'] })).nodes[0].type, 'door');
  const { payload: pagePayload, pageMappings } = adapter.exportForPage(first);
  assert.equal(pagePayload.sourcePlanSha256, project.provenance.sourcePlanSha256);
  assert.deepEqual(pagePayload.designQuality, first.designQuality);
  assert.doesNotMatch(JSON.stringify(pagePayload), /projectId|ownerId|sourceId|requirementIds/);
  assert.doesNotMatch(JSON.stringify(pagePayload), /renovation_/);
  assert.match(pageMappings.entry, /^page-door-/);
  assert.equal(typeof adapter.createProject, 'function');
  assert.equal(typeof adapter.applyOperations, 'function');
  assert.equal(typeof adapter.undo, 'function');
  assert.equal(typeof adapter.redo, 'function');
});

test('compiles a two-level scene with stair, void guardrail, and level controls', async () => {
  const harness = makeHarness('duplex', { multiLevel: true, alternatives: false });
  const result = await compileProjectScene(harness.projectDir, harness.context, { baseRevision: 1 });
  const types = Object.values(result.scene.scene.nodes).map((node) => node.type);
  assert.equal(result.project.quality.blockingCount, 0, fs.readFileSync(path.join(harness.projectDir, 'derived', 'audit.json'), 'utf8'));
  assert.equal(types.filter((type) => type === 'level').length, 2);
  assert.ok(types.includes('stair'));
  assert.ok(types.includes('fence'));
  assert.ok(result.scene.mappings['stair-main']);
  assert.ok(result.scene.mappings['guardrail-main']);
  const pageDir = path.join(harness.projectDir, 'derived', 'duplex-page');
  const page = generateProfessionalPage({
    projectDir: harness.projectDir,
    context: harness.context,
    output: pageDir,
    skillRoot,
    delivery: loadInteriorDeliveryContract(skillRoot),
  });
  const duplexHtml = fs.readFileSync(page.indexPath, 'utf8');
  const fallbackPlan = duplexHtml.match(/<svg class="plan-svg" id="model-derived-plan"[\s\S]*?<\/svg>/)?.[0] || '';
  assert.equal((fallbackPlan.match(/data-level-plan=/g) || []).length, 2);
  assert.equal((duplexHtml.match(/id="model-derived-plan"/g) || []).length, 1);
  const unsafe = structuredClone(result.project);
  selectedLevel(unsafe).guardrails = [];
  assert.ok(auditProfessionalProject(unsafe, result.scene).findings.some((entry) => entry.ruleId === 'multilevel.void-unguarded'));
  const disconnected = structuredClone(result.project);
  selectedLevel(disconnected).stairs[0].position = [100, 100];
  assert.ok(auditProfessionalProject(disconnected, result.scene).findings.some((entry) => entry.ruleId === 'circulation.stair-unreachable'));
});

test('applies revision-safe changes and preserves deterministic undo and redo states', async () => {
  const harness = makeHarness('revisions');
  const compiled = await compileProjectScene(harness.projectDir, harness.context, { baseRevision: 1 });
  const originalHash = compiled.scene.sceneHash;
  const changed = await applySceneOperations(harness.projectDir, harness.context, [{
    op: 'update-item',
    levelId: 'ground',
    itemId: 'sofa',
    patch: { color: '#4f6658' },
  }], { baseRevision: 2 });
  assert.equal(changed.project.revision, 3);
  assert.notEqual(changed.scene.sceneHash, originalHash);
  await assert.rejects(
    applySceneOperations(harness.projectDir, harness.context, [{
      op: 'update-item',
      levelId: 'ground',
      itemId: 'sofa',
      patch: { color: '#ffffff' },
    }], { baseRevision: 2 }),
    (error) => error.code === 'REVISION_CONFLICT' && error.detail.replayable === true,
  );
  const changedAgain = await applySceneOperations(harness.projectDir, harness.context, [{
    op: 'update-item',
    levelId: 'ground',
    itemId: 'sofa',
    patch: { color: '#6d4d3f' },
  }], { baseRevision: 3 });
  const undoneOnce = await undoProjectRevision(harness.projectDir, harness.context, { baseRevision: 4 });
  assert.equal(undoneOnce.scene.sceneHash, changed.scene.sceneHash);
  assert.equal(undoneOnce.restoredRevision, 3);
  const undoneTwice = await undoProjectRevision(harness.projectDir, harness.context, { baseRevision: 5 });
  assert.equal(undoneTwice.scene.sceneHash, originalHash);
  assert.equal(undoneTwice.restoredRevision, 2);
  const redoneOnce = await redoProjectRevision(harness.projectDir, harness.context, { baseRevision: 6 });
  assert.equal(redoneOnce.scene.sceneHash, changed.scene.sceneHash);
  const redoneTwice = await redoProjectRevision(harness.projectDir, harness.context, { baseRevision: 7 });
  assert.equal(redoneTwice.scene.sceneHash, changedAgain.scene.sceneHash);
  fs.writeFileSync(path.join(harness.projectDir, 'derived', 'audit.json'), '{"tampered":true}\n');
  assert.throws(() => readProject(harness.projectDir, harness.context), /complete project revision|manifest/);
  const recovered = recoverProjectRevision(harness.projectDir, harness.context, 2);
  assert.equal(recovered.project.revision, 2);
  assert.equal(recovered.scene.sceneHash, originalHash);
  assert.equal(readProject(harness.projectDir, harness.context).project.revision, 2);
});

test('professional gates deterministically expose geometry, clearance, evidence, requirements, material, budget, and safety failures', async () => {
  const harness = makeHarness('quality');
  const compiled = await compileProjectScene(harness.projectDir, harness.context, { baseRevision: 1 });
  const current = compiled.project;
  const scene = compiled.scene;
  const rulesFor = (mutate) => {
    const project = structuredClone(current);
    mutate(project);
    return auditProfessionalProject(project, scene).findings.map((entry) => entry.ruleId);
  };

  assert.ok(rulesFor((project) => {
    const items = selectedLevel(project).items;
    items[1].position = items[0].position;
    items[1].rotation = 37;
  }).includes('spatial.item-collision'));
  assert.ok(rulesFor((project) => { selectedLevel(project).openings[0].position = 0.01; }).includes('topology.opening-outside-wall'));
  assert.ok(rulesFor((project) => {
    const opening = structuredClone(selectedLevel(project).openings[0]);
    opening.openingId = 'conflicting-opening';
    opening.position += 0.01;
    selectedLevel(project).openings.push(opening);
  }).includes('topology.opening-conflict'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).openings = selectedLevel(project).openings.filter((opening) => opening.wallId !== 'partition');
  }).includes('circulation.room-unreachable'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).openings.find((opening) => opening.openingId === 'bed-door').type = 'window';
  }).includes('circulation.room-unreachable'), 'a window cutout must not become a walkable edge');
  assert.ok(rulesFor((project) => {
    selectedLevel(project).openings.find((opening) => opening.openingId === 'bed-door').width = 0.6;
  }).includes('circulation.minimum-width'));
  const sourcedThresholdProject = structuredClone(current);
  sourcedThresholdProject.brief.qualityThresholds = {
    minimumPassageWidthMetres: { value: 0.9, source: 'user-requirement', reference: 'req-continuous-circulation' },
  };
  const sourcedThresholdIssue = auditProfessionalProject(sourcedThresholdProject, scene).findings.find((entry) => entry.ruleId === 'circulation.minimum-width');
  assert.equal(sourcedThresholdIssue.thresholdSource, 'user-requirement');
  assert.equal(sourcedThresholdIssue.threshold.minimumPassageWidthMetres, 0.9);
  assert.ok(rulesFor((project) => {
    const level = selectedLevel(project);
    level.footprint = [[0, 0], [40, 0], [40, 40], [0, 40]];
    level.rooms = [{ ...level.rooms[0], polygon: level.footprint }];
    level.items = [];
  }).includes('circulation.edge-capacity'));
  assert.ok(rulesFor((project) => { project.brief.requirements[0].status = 'unresolved'; }).includes('requirements.must-unresolved'));
  assert.ok(rulesFor((project) => {
    project.evidence.push(
      calibratedEvidence('measure-a', 4, 'shared-segment'),
      calibratedEvidence('measure-b', 5, 'shared-segment'),
    );
  }).includes('evidence.calibration-conflict'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).rooms[0].kind = 'bathroom';
    project.designIntent.materials.find((material) => material.materialId === selectedLevel(project).rooms[0].materialId).wetAreaSuitability = 'unsuitable';
  }).includes('materials.wet-area-unsuitable'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).rooms[0].materialId = 'missing-material-intent';
  }).includes('materials.intent-missing'));
  assert.ok(rulesFor((project) => {
    delete project.designIntent.materials[0].roughness;
  }).includes('materials.render-contract-incomplete'));
  assert.ok(rulesFor((project) => {
    project.designIntent.lighting = [];
  }).includes('design.lighting-unspecified'));
  assert.ok(rulesFor((project) => {
    project.designIntent.rendering.cameras = [];
  }).includes('design.camera-missing'));
  assert.ok(rulesFor((project) => {
    project.designIntent.rendering.geometryLocked = false;
  }).includes('render.geometry-unlocked'));
  assert.ok(rulesFor((project) => {
    project.designIntent.rendering.controlPasses = ['depth'];
  }).includes('render.control-passes-missing'));
  assert.ok(rulesFor((project) => {
    delete selectedLevel(project).items[0].assetProfile;
  }).includes('assets.profile-incomplete'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).rooms[0].requirementIds = [];
  }).includes('trace.room-unmapped'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).items[0].requirementIds = [];
  }).includes('trace.fixed-element-unmapped'));
  assert.ok(rulesFor((project) => {
    delete selectedLevel(project).items[0].materialId;
  }).includes('trace.fixed-element-material-unmapped'));
  assert.ok(rulesFor((project) => {
    project.brief.budget = { currency: 'CNY', totalMinor: 1_000_000, confidence: 'estimated' };
    project.concepts.find((concept) => concept.conceptId === project.selectedConceptId).budgetItems = [];
  }).includes('budget.scope-unallocated'));
  assert.ok(rulesFor((project) => {
    project.brief.budget = { currency: 'CNY', totalMinor: 1_000_000, confidence: 'estimated' };
    project.concepts.find((concept) => concept.conceptId === project.selectedConceptId).budgetItems = [{
      budgetItemId: 'budget-layout',
      category: 'layout',
      amountMinor: 500_000,
      confidence: 'estimated',
      scopeIds: ['layout'],
    }];
  }).includes('budget.scope-omitted'));
  assert.ok(rulesFor((project) => {
    project.brief.schedule = { confidence: 'estimated', phases: [] };
  }).includes('schedule.scope-unallocated'));
  assert.ok(rulesFor((project) => { project.brief.scope.push('燃气管改动'); }).includes('safety.gas-verification-missing'));
  assert.ok(rulesFor((project) => {
    selectedLevel(project).voids = [{ voidId: 'unsafe-void', polygon: [[1, 1], [2, 1], [2, 2], [1, 2]] }];
  }).includes('multilevel.void-unguarded') === false, 'single-level voids do not pretend to be a multilevel condition');

  const blockers = auditProfessionalProject({ ...current, evidence: [] }, scene).findings.filter((entry) => entry.severity === 'blocking');
  assert.ok(blockers.length > 0);
  assert.ok(blockers.every((entry) => entry.nodeIds.length && entry.measurement && entry.fix));
});

test('generates a deterministic renovation booklet with a separate private offline Pascal 3D Page', async () => {
  const harness = makeHarness('page');
  const compiled = await compileProjectScene(harness.projectDir, harness.context, { baseRevision: 1 });
  assert.equal(compiled.project.status, 'quality_gated');
  const delivery = loadInteriorDeliveryContract(skillRoot);
  const firstDir = path.join(harness.projectDir, 'derived', 'page-a');
  const secondDir = path.join(harness.projectDir, 'derived', 'page-b');
  const first = generateProfessionalPage({ projectDir: harness.projectDir, context: harness.context, output: firstDir, skillRoot, delivery });
  const second = generateProfessionalPage({ projectDir: harness.projectDir, context: harness.context, output: secondDir, skillRoot, delivery });
  const firstHtml = fs.readFileSync(first.indexPath, 'utf8');
  const secondHtml = fs.readFileSync(second.indexPath, 'utf8');
  const firstThreeD = fs.readFileSync(first.specialistPages.threeD, 'utf8');
  const secondThreeD = fs.readFileSync(second.specialistPages.threeD, 'utf8');
  assert.equal(sha256(firstHtml), sha256(secondHtml));
  assert.equal(sha256(firstThreeD), sha256(secondThreeD));
  assert.deepEqual(verifyProfessionalPageHtml({ html: firstHtml, threeDHtml: firstThreeD }, delivery), first.verification);
  assert.match(firstHtml, /data-engine="pascal-v2"/);
  assert.match(firstHtml, /data-layout-profile="renovation-booklet"/);
  assert.match(firstHtml, /href="3d\/index.html"[^>]*target="_blank"/);
  assert.match(firstHtml, /项目摘要与需求/);
  assert.match(firstHtml, /完整设计说明/);
  assert.match(firstHtml, /材料清单与预算范围/);
  assert.match(firstHtml, /设计一致性检查/);
  assert.match(firstHtml, /设计过程与确认点/);
  assert.match(firstHtml, /排除项、落地顺序与复尺清单/);
  assert.doesNotMatch(firstHtml, /<iframe\b|id="pascal-scene"|pascal-viewer-warmup/);
  assert.match(firstHtml, /media\/source-plan\.png/);
  assert.match(firstHtml, /用户原图是唯一户型依据/);
  assert.match(firstHtml, /概念效果不替代施工图或材料实样/);
  assert.match(firstHtml, /plan-source-image/);
  assert.match(firstHtml, /plan-annotation-image/);
  assert.match(firstThreeD, /id="model-derived-plan"/);
  assert.match(firstThreeD, /data-level-mode="exploded"/);
  assert.match(firstThreeD, /data-label-mode="visible"/);
  assert.doesNotMatch(firstThreeD, /data-camera-shot/);
  assert.match(firstThreeD, /connect-src 'none'/);
  assert.match(firstThreeD, /正在装配模型/);
  assert.match(firstThreeD, /data-viewer-status/);
  assert.match(firstThreeD, /data-layout-profile="su-design-classic"/);
  assert.match(firstThreeD, /data-specialist-page="three-d"/);
  assert.doesNotMatch(firstThreeD, /项目摘要与需求|完整设计说明|材料清单与预算范围|设计过程与确认点/);
  assert.doesNotMatch(firstThreeD, /<(?:section|article|aside)[^>]+(?:id|class)=["'][^"']*(?:requirements?|brief|narrative)[^"']*["']/i);
  assert.match(firstThreeD, /pascal-viewer-warmup/);
  assert.match(firstThreeD, /landscape-mapped/);
  assert.doesNotMatch(`${firstHtml}\n${firstThreeD}`, /space-page|owner-page|managedObjectId|file:\/\/|localhost|127\.0\.0\.1|sourceMappingURL/);
  assert.doesNotMatch(`${firstHtml}\n${firstThreeD}`, /renovation_|concept-open-living|req-continuous-circulation|decision-select-open-living|evidence-source/);
  assert.doesNotMatch(fs.readFileSync(path.join(firstDir, 'scene.json'), 'utf8'), /renovation_|projectId|ownerId|spaceId|sourceId/);
  assert.ok(first.entryBytes < 10 * 1024 * 1024);
  assert.ok(fs.readdirSync(firstDir).includes('media'));
  assert.equal(fs.existsSync(path.join(firstDir, '3d', 'index.html')), true);
  const preservedHash = sha256(fs.readFileSync(first.indexPath));
  const evidenceDirectory = path.join(harness.projectDir, 'evidence');
  const preservedEvidenceDirectory = path.join(harness.projectDir, 'evidence-preserved');
  const externalEvidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-interior-evidence-'));
  fs.copyFileSync(sourcePlanPath, path.join(externalEvidenceDirectory, 'source-plan.png'));
  fs.renameSync(evidenceDirectory, preservedEvidenceDirectory);
  fs.symlinkSync(externalEvidenceDirectory, evidenceDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => generateProfessionalPage({ projectDir: harness.projectDir, context: harness.context, output: firstDir, skillRoot, delivery }), /evidence directory.*symbolic link/);
  fs.unlinkSync(evidenceDirectory);
  fs.renameSync(preservedEvidenceDirectory, evidenceDirectory);
  const sourcePlanProjectPath = path.join(evidenceDirectory, 'source-plan.png');
  const originalSourcePlan = fs.readFileSync(sourcePlanProjectPath);
  fs.copyFileSync(annotationPath, sourcePlanProjectPath);
  assert.throws(
    () => generateProfessionalPage({ projectDir: harness.projectDir, context: harness.context, output: firstDir, skillRoot, delivery }),
    /share one verified model basis|evidence hash does not match/,
  );
  fs.writeFileSync(sourcePlanProjectPath, originalSourcePlan);
  const auditPath = path.join(harness.projectDir, 'derived', 'audit.json');
  const blockedAudit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  blockedAudit.ok = false;
  blockedAudit.blockingCount = 1;
  fs.writeFileSync(auditPath, `${JSON.stringify(blockedAudit, null, 2)}\n`);
  assert.throws(() => generateProfessionalPage({ projectDir: harness.projectDir, context: harness.context, output: firstDir, skillRoot, delivery }), /complete project revision|manifest|quality report hash|quality gate blocks/);
  assert.equal(sha256(fs.readFileSync(first.indexPath)), preservedHash);
});

test('keeps source-plan inputs passive and rejects MIME disguise and active SVG', () => {
  assert.match(loadSourcePlanAsset(sourcePlanPath).dataUrl, /^data:image\/png;base64,/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-interior-source-'));
  const disguised = path.join(directory, 'fake.png');
  fs.writeFileSync(disguised, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.throws(() => loadSourcePlanAsset(disguised), /does not match/);
  const active = path.join(directory, 'active.svg');
  fs.writeFileSync(active, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.throws(() => loadSourcePlanAsset(active), /executable/);
  const oversized = path.join(directory, 'oversized.png');
  const pngHeader = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader);
  Buffer.from('IHDR').copy(pngHeader, 12);
  pngHeader.writeUInt32BE(25_000, 16);
  pngHeader.writeUInt32BE(25_000, 20);
  fs.writeFileSync(oversized, pngHeader);
  assert.throws(() => loadSourcePlanAsset(oversized), /dimensions exceed/);
});

test('formal v2 schema and runtime validator reject oversized or structurally incomplete projects', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas/project-v2.schema.json'), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.$defs.evidence.properties.classification.enum.includes('revision-annotation'));
  assert.ok(schema.$defs.evidence.properties.classification.enum.includes('concept-render'));
  assert.ok(schema.$defs.concept.required.includes('sourcePlanEvidenceId'));
  assert.ok(schema.$defs.provenance.required.includes('sourcePlanSha256'));
  const project = createProjectFromSeed(baseSeed(), { spaceRoot: '/tmp', spaceId: 'schema-space', ownerId: 'schema-owner' }, { now: () => '2026-07-27T00:00:00.000Z' });
  assert.equal(project.concepts.every((concept) => concept.sourcePlanEvidenceId === project.provenance.sourcePlanEvidenceId), true);
  const broken = structuredClone(project);
  delete broken.evidence[0].calibration;
  assert.match(validateProjectV2(broken).join('\n'), /calibration/);
  const invalidManagedObject = structuredClone(project);
  delete invalidManagedObject.evidence[0].relativePath;
  invalidManagedObject.evidence[0].managedObjectId = 'obj_from-another-space';
  assert.match(validateProjectV2(invalidManagedObject).join('\n'), /managedObjectId is invalid/);
  const unrelatedModelBasis = structuredClone(project);
  unrelatedModelBasis.provenance.sourcePlanSha256 = '0'.repeat(64);
  assert.match(validateProjectV2(unrelatedModelBasis).join('\n'), /sourcePlanSha256 must match/);
  const governedRender = createProjectFromSeed(nativeSeed, { spaceRoot: '/tmp', spaceId: 'render-space', ownerId: 'render-owner' }, { now: () => '2026-07-27T00:00:00.000Z' });
  delete governedRender.evidence.find((entry) => entry.classification === 'concept-render').generation.promptSha256;
  assert.match(validateProjectV2(governedRender).join('\n'), /generation\.promptSha256 must be sha256/);
  const tooManyLevels = structuredClone(project);
  tooManyLevels.concepts[0].levels.push(structuredClone(tooManyLevels.concepts[0].levels[0]), structuredClone(tooManyLevels.concepts[0].levels[0]));
  assert.match(validateProjectV2(tooManyLevels).join('\n'), /at most 2 levels/);
});

test('keeps the latest 50 project revisions active and archives older complete history', () => {
  const harness = makeHarness('history');
  let current = readProject(harness.projectDir, harness.context).project;
  for (let index = 0; index < 52; index += 1) {
    const next = structuredClone(current);
    next.baseRevision = current.revision;
    next.status = 'revised';
    current = writeProjectRevision(harness.projectDir, current, next, {
      now: () => new Date(Date.parse('2026-07-27T00:00:00.000Z') + (index + 1) * 1000).toISOString(),
    });
  }
  const historyRoot = path.join(harness.projectDir, 'history');
  assert.equal(fs.readdirSync(historyRoot).filter((name) => /^\d{6}\.project\.json$/.test(name)).length, 50);
  assert.equal(fs.existsSync(path.join(historyRoot, 'archive', '000001.project.json')), true);
  assert.equal(readProject(harness.projectDir, harness.context).project.revision, 53);
});

test('keeps warm-cache schema, scene, audit, and Page work inside the v2 performance baselines', async () => {
  const harness = makeHarness('performance');
  const project = readProject(harness.projectDir, harness.context).project;
  const adapter = new PascalInteriorAdapter();
  await adapter.compileScene(project);
  const compileDurations = [];
  let snapshot = null;
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    snapshot = await adapter.compileScene(project);
    compileDurations.push(performance.now() - started);
  }
  const schemaDurations = Array.from({ length: 20 }, () => {
    const started = performance.now();
    assert.deepEqual(validateProjectV2(project, { context: harness.context }), []);
    return performance.now() - started;
  });
  const auditDurations = Array.from({ length: 10 }, () => {
    const started = performance.now();
    assert.equal(auditProfessionalProject(project, snapshot).blockingCount, 0);
    return performance.now() - started;
  });
  await compileProjectScene(harness.projectDir, harness.context, { baseRevision: 1 });
  const delivery = loadInteriorDeliveryContract(skillRoot);
  const pageDurations = Array.from({ length: 3 }, (_, index) => {
    const started = performance.now();
    generateProfessionalPage({
      projectDir: harness.projectDir,
      context: harness.context,
      output: path.join(harness.projectDir, 'derived', `performance-page-${index}`),
      skillRoot,
      delivery,
    });
    return performance.now() - started;
  });
  assert.ok(percentile95(schemaDurations) <= 250, `schema p95 ${percentile95(schemaDurations).toFixed(1)}ms`);
  assert.ok(percentile95(compileDurations) <= 2_000, `scene p95 ${percentile95(compileDurations).toFixed(1)}ms`);
  assert.ok(percentile95(auditDurations) <= 1_000, `audit p95 ${percentile95(auditDurations).toFixed(1)}ms`);
  assert.ok(percentile95(pageDurations) <= 3_000, `Page p95 ${percentile95(pageDurations).toFixed(1)}ms`);
});

function makeHarness(name, { multiLevel = false, alternatives = true } = {}) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `pa-interior-${name}-`));
  const spaceRoot = path.join(runtimeRoot, 'space');
  fs.mkdirSync(path.join(spaceRoot, 'projects'), { recursive: true });
  const context = { spaceRoot, spaceId: `space-${name}`, ownerId: `owner-${name}` };
  const projectDir = path.join(spaceRoot, 'projects', `home-renovation-${name}`);
  const seed = baseSeed();
  if (!alternatives) {
    seed.concepts = [seed.concepts[0]];
    seed.concepts[0].singleOptionReason = 'This test isolates one selected concept.';
  }
  if (multiLevel) {
    seed.concepts = [makeDuplexConcept(seed.concepts[0])];
    seed.selectedConceptId = 'concept-duplex';
  }
  initializeProject(projectDir, seed, context, { now: () => '2026-07-27T00:00:00.000Z' });
  fs.copyFileSync(sourcePlanPath, path.join(projectDir, 'evidence', 'source-plan.png'));
  fs.copyFileSync(annotationPath, path.join(projectDir, 'evidence', 'agent-annotation.png'));
  for (const render of renderPromptSet.renders) {
    const evidence = seed.evidence.find((entry) => entry.contentHash === render.imageSha256);
    const target = path.join(projectDir, evidence.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(exampleRoot, render.file), target);
  }
  return { runtimeRoot, spaceRoot, context, projectDir };
}

function baseSeed() {
  const seed = structuredClone(nativeSeed);
  const primaryConcept = compactRegressionConcept();
  const alternativeConcept = structuredClone(primaryConcept);
  alternativeConcept.conceptId = 'concept-compact-alternative';
  alternativeConcept.name = 'Compact alternative test concept';
  seed.concepts = [primaryConcept, alternativeConcept];
  seed.selectedConceptId = primaryConcept.conceptId;
  seed.brief.requirements = [
    {
      requirementId: 'req-continuous-circulation',
      source: 'Deterministic regression fixture',
      summary: 'Keep a traceable route from the entry to both rooms.',
      priority: 'must',
      status: 'satisfied',
      sceneNodeIds: ['entry', 'living', 'bed-door', 'bedroom'],
      verification: { method: 'deterministic-spatial-audit', result: 'passed' },
    },
    {
      requirementId: 'req-furniture-clearance',
      source: 'Deterministic regression fixture',
      summary: 'Keep the compact furniture layout collision free.',
      priority: 'must',
      status: 'satisfied',
      sceneNodeIds: ['sofa', 'table', 'bed'],
      verification: { method: 'deterministic-clearance-audit', result: 'passed' },
    },
  ];
  for (const concept of seed.concepts) {
    for (const level of concept.levels) {
      for (const room of level.rooms) {
        room.requirementIds = ['req-continuous-circulation'];
      }
      for (const item of level.items) {
        item.requirementIds = ['req-furniture-clearance'];
      }
    }
  }
  seed.decisions = [{
    decisionId: 'decision-select-compact-primary',
    summary: 'Select the stable compact fixture for deterministic tests.',
    rationale: 'The shipping professional Agent delivery remains free to increase in spatial and furnishing detail.',
    requirementIds: ['req-continuous-circulation', 'req-furniture-clearance'],
  }];
  return seed;
}

function compactRegressionConcept() {
  return {
    conceptId: 'concept-compact-primary',
    name: 'Compact primary test concept',
    summary: 'Stable two-room fixture used only by engine regression tests.',
    tradeoffs: ['This compact fixture isolates deterministic engine behavior from the shipping Agent delivery.'],
    budgetItems: [],
    levels: [{
      levelId: 'ground',
      name: 'Ground level',
      elevation: 0,
      height: 2.8,
      footprint: [[0, 0], [7, 0], [7, 6], [0, 6]],
      rooms: [
        {
          roomId: 'living',
          name: 'Living room',
          kind: 'living',
          polygon: [[0, 0], [4, 0], [4, 6], [0, 6]],
          materialId: 'warm-oak',
          requiredAccess: true,
          evidenceIds: ['evidence-source-plan-redacted'],
          requirementIds: ['req-continuous-circulation'],
        },
        {
          roomId: 'bedroom',
          name: 'Bedroom',
          kind: 'bedroom',
          polygon: [[4, 0], [7, 0], [7, 6], [4, 6]],
          materialId: 'warm-oak',
          requiredAccess: true,
          evidenceIds: ['evidence-source-plan-redacted'],
          requirementIds: ['req-continuous-circulation'],
        },
      ],
      walls: [
        { wallId: 'south', start: [0, 0], end: [7, 0], height: 2.8, thickness: 0.16, exteriorEdge: 0 },
        { wallId: 'east', start: [7, 0], end: [7, 6], height: 2.8, thickness: 0.16, exteriorEdge: 1 },
        { wallId: 'north', start: [7, 6], end: [0, 6], height: 2.8, thickness: 0.16, exteriorEdge: 2 },
        { wallId: 'west', start: [0, 6], end: [0, 0], height: 2.8, thickness: 0.16, exteriorEdge: 3 },
        { wallId: 'partition', start: [4, 0], end: [4, 6], height: 2.8, thickness: 0.12, exteriorEdge: -1 },
      ],
      openings: [
        {
          openingId: 'entry',
          type: 'door',
          wallId: 'south',
          position: 0.18,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          connectsRoomIds: ['living'],
          isEntry: true,
          hingesSide: 'right',
          swingDirection: 'inward',
        },
        {
          openingId: 'bed-door',
          type: 'door',
          wallId: 'partition',
          position: 0.72,
          width: 0.85,
          height: 2.1,
          sillHeight: 0,
          connectsRoomIds: ['living', 'bedroom'],
          hingesSide: 'right',
          swingDirection: 'inward',
        },
        {
          openingId: 'north-window',
          type: 'window',
          wallId: 'north',
          position: 0.5,
          width: 1.8,
          height: 1.3,
          sillHeight: 0.9,
          connectsRoomIds: ['bedroom'],
        },
      ],
      items: [
        {
          itemId: 'sofa',
          name: 'Sofa',
          kind: 'sofa',
          roomId: 'living',
          position: [1.35, 3.8],
          size: [2, 0.85, 0.8],
          rotation: 0,
          materialId: 'warm-white',
          color: '#E9E6DE',
          clearanceExempt: false,
          requirementIds: ['req-furniture-clearance'],
        },
        {
          itemId: 'table',
          name: 'Dining table',
          kind: 'table-round',
          roomId: 'living',
          position: [2.55, 1.3],
          size: [1, 1, 0.74],
          rotation: 0,
          materialId: 'oak-dark',
          color: '#80664D',
          clearanceExempt: false,
          requirementIds: ['req-furniture-clearance'],
        },
        {
          itemId: 'bed',
          name: 'Bed',
          kind: 'bed',
          roomId: 'bedroom',
          position: [5.55, 3],
          size: [1.8, 2, 0.62],
          rotation: 0,
          materialId: 'warm-white',
          color: '#E9E6DE',
          clearanceExempt: false,
          requirementIds: ['req-furniture-clearance'],
        },
      ],
      stairs: [],
      guardrails: [],
      voids: [],
    }],
  };
}

function makeDuplexConcept(source) {
  const lower = structuredClone(source.levels[0]);
  const upper = structuredClone(source.levels[0]);
  const roomIds = new Map(upper.rooms.map((room) => [room.roomId, `upper-${room.roomId}`]));
  const wallIds = new Map(upper.walls.map((wall) => [wall.wallId, `upper-${wall.wallId}`]));
  upper.levelId = 'upper';
  upper.name = 'Upper level';
  upper.elevation = 3;
  upper.rooms = upper.rooms.map((room) => ({ ...room, roomId: roomIds.get(room.roomId) }));
  upper.walls = upper.walls.map((wall) => ({ ...wall, wallId: wallIds.get(wall.wallId) }));
  upper.openings = upper.openings.map((opening) => ({
    ...opening,
    openingId: `upper-${opening.openingId}`,
    wallId: wallIds.get(opening.wallId),
    connectsRoomIds: (opening.connectsRoomIds || []).map((id) => roomIds.get(id)),
  }));
  upper.items = upper.items.map((item) => ({ ...item, itemId: `upper-${item.itemId}`, roomId: roomIds.get(item.roomId) }));
  upper.stairs = [];
  upper.voids = [];
  upper.guardrails = [];
  lower.stairs = [{
    stairId: 'stair-main',
    toLevelId: 'upper',
    position: [3.25, 2.4],
    width: 1,
    runLength: 3.6,
    totalRise: 3,
    headroom: 2.1,
  }];
  lower.voids = [{ voidId: 'void-main', polygon: [[2.6, 1.8], [4.2, 1.8], [4.2, 3.2], [2.6, 3.2]] }];
  lower.guardrails = [
    ['guardrail-main', [2.6, 1.8], [4.2, 1.8]],
    ['guardrail-east', [4.2, 1.8], [4.2, 3.2]],
    ['guardrail-south', [4.2, 3.2], [2.6, 3.2]],
    ['guardrail-west', [2.6, 3.2], [2.6, 1.8]],
  ].map(([guardrailId, start, end]) => ({
    guardrailId,
    voidId: 'void-main',
    name: 'Stair void guardrail',
    start,
    end,
    height: 1.05,
    thickness: .06,
  }));
  return {
    ...structuredClone(source),
    conceptId: 'concept-duplex',
    name: '复式连续空间方案',
    summary: '用明确楼梯、挑空和连续栏杆连接两层概念空间。',
    singleOptionReason: '复式测试固定建筑边界，仅验证多层专业能力。',
    levels: [lower, upper],
  };
}

function selectedLevel(project) {
  return project.concepts.find((concept) => concept.conceptId === project.selectedConceptId).levels[0];
}

function calibratedEvidence(id, knownLengthMetres, segmentId) {
  return {
    evidenceId: id,
    relativePath: 'evidence/source-plan.png',
    classification: 'measurement',
    orientation: 'north-up',
    calibration: { basis: 'known-length', segmentId, knownLengthMetres, unit: 'm' },
    confidence: 'verified',
    allowedUses: ['structure'],
    observations: ['Synthetic calibration fixture.'],
    inferences: [],
    redactionStatus: 'redacted',
    contentHash: sha256(fs.readFileSync(sourcePlanPath)),
  };
}

function percentile95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}
