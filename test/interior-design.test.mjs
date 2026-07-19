import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePage } from '../skills/interior-design/scripts/generate-page.mjs';
import { normalizeModel, validateModel } from '../skills/interior-design/scripts/model.mjs';

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

test('generates the self-contained static renovation delivery template', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-page-'));
  const index = generatePage({ model: fixture, output, skillRoot: path.join(root, 'skills/interior-design') });
  const html = fs.readFileSync(index, 'utf8');
  assert.match(html, /OrbitControls/);
  assert.match(html, /id="room-select"/);
  assert.match(html, /整体方案 · 完整户型/);
  assert.match(html, /3D 鸟瞰/);
  assert.match(html, /3D 投影模式/);
  assert.match(html, /pointermove/);
  assert.doesNotMatch(html, /id="play"|id="replay"|class="timeline"|animateTimeline|cameraTour/);
  assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.ok(fs.statSync(index).size > 100_000);
});
