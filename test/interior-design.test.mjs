import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePage } from '../skills/interior-design/scripts/generate-page.mjs';
import { normalizeModel, validateModel } from '../skills/interior-design/scripts/model.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/skill-cases/interior-design/model.json'), 'utf8'));

test('validates duplex invariants and rejects broken geometry', () => {
  assert.deepEqual(validateModel(fixture), []);
  const broken = structuredClone(fixture); broken.furniture[0].roomId = 'missing';
  assert.match(validateModel(broken).join('\n'), /roomId does not resolve/);
  const disconnected = structuredClone(fixture); disconnected.stairs[0].toLevelId = 'roof';
  assert.match(validateModel(disconnected).join('\n'), /level reference does not resolve/);
  const intruding = structuredClone(fixture); intruding.slabs[0].polygon = [[3,0],[7,0],[7,6],[3,6]];
  assert.match(validateModel(intruding).join('\n'), /upper slab overlaps void living-void/);
});

test('normalizes legacy duplex coordinates and vertical geometry', () => {
  const raw = structuredClone(fixture); delete raw.project.sourceAreaM2;
  raw.project.scale = { basis: 'known-length', metresPerUnit: 2, confidence: 0.8 };
  raw.rooms.forEach((room) => { room.polygon = room.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.walls.forEach((wall) => { wall.from = [wall.from[0] - 3, wall.from[1] - 2]; wall.to = [wall.to[0] - 3, wall.to[1] - 2]; });
  raw.furniture.forEach((item) => { item.position = [item.position[0] - 3, item.position[1] - 2]; });
  raw.slabs.forEach((slab) => { slab.polygon = slab.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.voids.forEach((item) => { item.polygon = item.polygon.map(([x, z]) => [x - 3, z - 2]); });
  raw.stairs.forEach((stair) => { stair.start = [stair.start[0] - 3, stair.start[1] - 2]; stair.end = [stair.end[0] - 3, stair.end[1] - 2]; });
  raw.railings.forEach((railing) => { railing.points = railing.points.map(([x, z]) => [x - 3, z - 2]); });
  const normalized = normalizeModel(raw);
  assert.equal(normalized.project.areaM2, 168);
  assert.equal(normalized.project.designedFloorAreaM2, 240);
  assert.equal(normalized.levels[1].elevation, 6);
  assert.deepEqual(validateModel(normalized), []);
});

test('validates single-level review views, routes and annotations', () => {
  const model = singleLevelFixture();
  assert.deepEqual(validateModel(model), []);
  const vertical = structuredClone(model); vertical.stairs = [{ id:'bad', fromLevelId:'main', toLevelId:'main', start:[0,0], end:[1,1], width:1 }];
  assert.match(validateModel(vertical).join('\n'), /singleLevelOnly forbids stairs/);
  const tall = structuredClone(model); tall.rooms[0].height = 3.4;
  assert.match(validateModel(tall).join('\n'), /height exceeds assertions\.maxRoomHeight/);
  const badView = structuredClone(model); badView.views[0].roomIds.push('missing');
  assert.match(validateModel(badView).join('\n'), /roomIds must resolve/);
});

test('generates self-contained single-level viewer with review and annotation controls', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'interior-page-'));
  const index = generatePage({ model: singleLevelFixture(), output, skillRoot: path.join(root, 'skills/interior-design') });
  const html = fs.readFileSync(index, 'utf8');
  assert.match(html, /OrbitControls/);
  assert.match(html, /单层装修/);
  assert.match(html, /公共区/);
  assert.match(html, /主卧聚焦/);
  assert.match(html, /id="annotation-select"/);
  assert.doesNotMatch(html, /旋转手机以横屏|continue-portrait|orientation\.lock/);
  assert.doesNotMatch(html, /<(?:script|link|iframe)[^>]+(?:src|href)=["']https?:\/\//i);
  assert.ok(fs.statSync(index).size > 100_000);
});

function singleLevelFixture() {
  return { schemaVersion:1, project:{ id:'single', title:'C 户型 · 单层装修概念初版', status:'concept', scale:{ basis:'estimated', metresPerUnit:1, confidence:.6 } }, levels:[{ id:'main', name:'一层', elevation:0, height:2.9 }], assertions:{ singleLevelOnly:true, maxRoomHeight:3.2 }, rooms:[{ id:'living', name:'客厅', levelId:'main', polygon:[[0,0],[4,0],[4,3],[0,3]], height:2.9, material:'wood' }], walls:[{ id:'wall', levelId:'main', from:[0,0], to:[4,0], height:2.9, thickness:.15 }], openings:[{ id:'window', kind:'window', wallId:'wall', roomId:'living', offset:.5, width:2, height:2.3 }], furniture:[{ id:'sofa', kind:'sofa', roomId:'living', levelId:'main', position:[2,1.5], size:[2,.9,.8], rotation:0, material:'fabric' }], materials:[{ id:'wood', name:'木地板', color:'#876d56', roughness:.7, pattern:'wood' },{ id:'fabric', name:'织物', color:'#ded6c9', roughness:.9, pattern:'fabric' }], views:[{ id:'overall', label:'整体', roomIds:['living'] },{ id:'public', label:'公共区', roomIds:['living'] },{ id:'master-focus', label:'主卧聚焦', roomIds:['living'], furnitureIds:['sofa'] }], circulationPaths:[{ id:'route', name:'动线', points:[[0,1],[3,1]], color:'#9a5546' }], annotations:[{ id:'north', category:'direction', text:'北', position:[2,2.8], evidence:'visible' }], lighting:{ mode:'day', ambient:1, shadows:true }, camera:{ initial:'isometric' } };
}
