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

test('generates a self-contained viewer without remote dependencies', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-page-'));
  const index = generatePage({ model: fixture, output, skillRoot: path.join(root, 'skills/interior-design') });
  const html = fs.readFileSync(index, 'utf8');
  assert.match(html, /OrbitControls/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.ok(fs.statSync(index).size > 100_000);
});
