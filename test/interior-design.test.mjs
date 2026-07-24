import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePage, loadInteriorTemplateContract, loadSourcePlanAsset, verifyGeneratedPageHtml } from '../skills/interior-design/scripts/generate-page.mjs';
import { auditModel, normalizeModel, validateModel } from '../skills/interior-design/scripts/model.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/skill-cases/interior-design/model.json'), 'utf8'));

test('validates the normalized concept fixture and rejects broken references', () => {
  assert.deepEqual(validateModel(fixture), []);
  const broken = structuredClone(fixture);
  broken.furniture[0].roomId = 'missing';
  assert.match(validateModel(broken).join('\n'), /roomId does not resolve/);
  broken.furniture[0].roomId = fixture.furniture[0].roomId;
  broken.camera.initial = 'tour';
  assert.match(validateModel(broken).join('\n'), /camera.initial is invalid/);
});

test('normalizes coordinates and recomputes room area', () => {
  const raw = structuredClone(fixture);
  raw.project.scale = { basis: 'known-length', metresPerUnit: 2, confidence: 0.8 };
  raw.rooms.forEach((room) => { room.polygon = room.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.walls.forEach((wall) => { wall.from = [wall.from[0] - 3, wall.from[1] - 2]; wall.to = [wall.to[0] - 3, wall.to[1] - 2]; });
  raw.furniture.forEach((item) => { item.position = [item.position[0] - 3, item.position[1] - 2]; });
  const normalized = normalizeModel(raw);
  assert.equal(normalized.project.scale.metresPerUnit, 1);
  assert.equal(normalized.project.areaM2, 168);
  assert.equal(normalized.project.bounds.minX, 0);
});

test('passes a recorded spatial and lifestyle walkthrough', () => {
  const report = auditModel(fixture);
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.equal(report.qualityReview.status, 'passed');
});

test('blocks furniture overlap, door obstruction, and missing review evidence', () => {
  const overlap = structuredClone(fixture);
  overlap.furniture[1].position = overlap.furniture[0].position;
  assert.ok(auditModel(overlap).findings.some((item) => item.code === 'furniture-overlap'));

  const blockedDoor = structuredClone(fixture);
  blockedDoor.furniture[1].position = [1.25, 0.35];
  assert.ok(auditModel(blockedDoor).findings.some((item) => item.code === 'door-clearance-blocked'));

  const unreviewed = structuredClone(fixture);
  delete unreviewed.qualityReview;
  assert.ok(auditModel(unreviewed).findings.some((item) => item.code === 'quality-review-missing'));
});

test('rejects executable or remote content in a supplied SVG floor plan', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-source-plan-'));
  const source = path.join(directory, 'unsafe.svg');
  fs.writeFileSync(source, '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/private.png"/></svg>');
  assert.throws(() => loadSourcePlanAsset(source), /must not contain executable or remote-reference markup/);
});

test('generates and verifies the registered self-contained renovation delivery template', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-page-'));
  const skillRoot = path.join(root, 'skills/interior-design');
  const template = loadInteriorTemplateContract(skillRoot);
  const sourcePlan = loadSourcePlanAsset(path.join(root, 'test/fixtures/skill-cases/interior-design/source-plan.svg'));
  const index = generatePage({ model: fixture, output, skillRoot, sourcePlan, template });
  const html = fs.readFileSync(index, 'utf8');
  assert.match(html, /OrbitControls/);
  assert.match(html, /id="room-select"/);
  assert.match(html, /整体方案 · 完整户型/);
  assert.match(html, /SU 设计稿/);
  assert.match(html, /户型图/);
  assert.match(html, /用户需求/);
  assert.match(html, /data-template-id="interior-design-delivery"/);
  assert.match(html, /name="personal-agent-page-template" content="personal-agent-page-template"/);
  assert.match(html, /class="plan-source-image"/);
  assert.match(html, /data:image\/svg\+xml;base64/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /3D 投影模式/);
  assert.match(html, /pointermove/);
  assert.doesNotMatch(html, /id="play"|id="replay"|class="timeline"|animateTimeline|cameraTour/);
  assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.deepEqual(verifyGeneratedPageHtml(html, template), {
    ok: true,
    templateId: 'interior-design-delivery',
    templateVersion: 1,
    artifactMarker: 'personal-agent-page-template',
    visualAcceptance: 'user',
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'template.json'), 'utf8')).implementation.version, 1);
  assert.ok(fs.statSync(index).size > 100_000);
});
