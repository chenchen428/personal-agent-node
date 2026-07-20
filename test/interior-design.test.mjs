import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePage } from '../skills/interior-design/scripts/generate-page.mjs';
import { normalizeModel, validateModel } from '../skills/interior-design/scripts/model.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/skill-cases/interior-design/model.json'), 'utf8'));

test('validates the normalized duplex fixture and rejects broken references', () => {
  assert.deepEqual(validateModel(fixture), []);
  const broken = structuredClone(fixture);
  broken.furniture[0].roomId = 'missing';
  assert.match(validateModel(broken).join('\n'), /roomId does not resolve/);
  broken.furniture[0].roomId = fixture.furniture[0].roomId;
  broken.camera.initial = 'tour';
  assert.match(validateModel(broken).join('\n'), /camera.initial is invalid/);
  const disconnected = structuredClone(fixture);
  disconnected.stairs[0].toLevelId = 'roof';
  assert.match(validateModel(disconnected).join('\n'), /stair main-stair: level reference does not resolve/);
});

test('normalizes duplex coordinates, vertical geometry and per-level area', () => {
  const raw = structuredClone(fixture);
  delete raw.project.sourceAreaM2;
  raw.project.scale = { basis: 'known-length', metresPerUnit: 2, confidence: 0.8 };
  raw.rooms.forEach((room) => { room.polygon = room.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.walls.forEach((wall) => { wall.from = [wall.from[0] - 3, wall.from[1] - 2]; wall.to = [wall.to[0] - 3, wall.to[1] - 2]; });
  raw.furniture.forEach((item) => { item.position = [item.position[0] - 3, item.position[1] - 2]; });
  raw.slabs.forEach((slab) => { slab.polygon = slab.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.voids.forEach((voidItem) => { voidItem.polygon = voidItem.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.stairs.forEach((stair) => { stair.start = [stair.start[0] - 3, stair.start[1] - 2]; stair.end = [stair.end[0] - 3, stair.end[1] - 2]; });
  raw.railings.forEach((railing) => { railing.points = railing.points.map(([x, z]) => [x - 3, z - 2]); });
  const normalized = normalizeModel(raw);
  assert.equal(normalized.project.scale.metresPerUnit, 1);
  assert.equal(normalized.project.areaM2, 168);
  assert.equal(normalized.project.levelAreasM2.upper, 72);
  assert.equal(normalized.project.designedFloorAreaM2, 240);
  assert.equal(normalized.project.bounds.minX, 0);
  assert.equal(normalized.levels[1].elevation, 6);
  assert.equal(normalized.voids[0].height, 12);
  assert.equal(normalized.stairs[0].rise, 6);
});

test('keeps legacy single-level models backward compatible', () => {
  const legacy = structuredClone(fixture);
  delete legacy.levels; delete legacy.slabs; delete legacy.voids; delete legacy.stairs; delete legacy.railings; delete legacy.presentation;
  legacy.rooms = legacy.rooms.filter((room) => room.levelId === 'lower').map(({ levelId, elevation, ...room }) => room);
  legacy.walls = legacy.walls.filter((wall) => wall.levelId === 'lower').map(({ levelId, elevation, sectionHidden, ...wall }) => wall);
  legacy.furniture = legacy.furniture.filter((item) => item.levelId === 'lower').map(({ levelId, elevation, ...item }) => item);
  assert.deepEqual(validateModel(legacy), []);
  assert.equal(normalizeModel(legacy).project.areaM2, 42);
});

test('generates the self-contained duplex renovation delivery template', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-page-'));
  const index = generatePage({ model: fixture, output, skillRoot: path.join(root, 'skills/interior-design') });
  const html = fs.readFileSync(index, 'utf8');
  assert.match(html, /OrbitControls/);
  assert.match(html, /id="room-select"/);
  assert.match(html, /整体方案 · 完整户型/);
  assert.match(html, /整体轴测/);
  assert.match(html, /挑空剖切/);
  assert.match(html, /兼容投影模式/);
  assert.match(html, /6 m living void/);
  assert.match(html, /pointermove/);
  assert.match(html, /requestAnimationFrame/);
  assert.doesNotMatch(html, /id="play"|id="replay"|class="timeline"|cameraTour/);
  assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.ok(fs.statSync(index).size > 100_000);
});
