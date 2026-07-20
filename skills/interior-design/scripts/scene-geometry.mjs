import * as THREE from 'three';

export function buildInteriorModel(model, scene) {
  const materials = new Map(model.materials.map((item) => [item.id, makeMaterial(item)]));
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#f3f1eb', roughness: 0.94 });
  const home = new THREE.Group();
  const records = [];
  scene.add(home);
  const add = (object, meta = {}) => { object.userData = { ...object.userData, ...meta }; home.add(object); records.push({ object, ...meta }); return object; };

  for (const room of model.rooms) {
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape(room.polygon)), cloneMaterial(materials, room.material, '#c9a77b'));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = elevation(model, room) + 0.018;
    floor.receiveShadow = true;
    add(floor, { kind: 'room', levelId: levelId(room), roomId: room.id });
    const center = polygonCenter(room.polygon);
    const label = labelSprite(room.name, { width: Math.min(2.4, Math.max(1.15, room.name.length * 0.22)), height: 0.34, color: '#315f4a', font: 30 });
    label.position.set(center[0], elevation(model, room) + 0.11, center[1]);
    add(label, { kind: 'label', levelId: levelId(room), roomId: room.id });
  }
  for (const slab of model.slabs || []) {
    const geometry = new THREE.ExtrudeGeometry(shape(slab.polygon), { depth: slab.thickness, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, cloneMaterial(materials, slab.material, '#c9a77b'));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = slab.elevation - slab.thickness;
    mesh.castShadow = mesh.receiveShadow = true;
    add(mesh, { kind: slab.kind, levelId: slab.levelId });
  }
  for (const wall of model.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wall.height, wall.thickness), wallMaterial.clone());
    const base = elevation(model, wall);
    mesh.position.set((x1 + x2) / 2, base + wall.height / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow = mesh.receiveShadow = true;
    add(mesh, { kind: 'wall', levelId: levelId(wall), sectionHidden: wall.sectionHidden === true });
  }
  for (const item of model.furniture) add(makeFurniture(item, materials, wallMaterial, elevation(model, item)), { kind: 'furniture', levelId: levelId(item), roomId: item.roomId });
  for (const stair of model.stairs || []) add(makeStair(stair, model, materials), { kind: 'vertical', levelId: stair.toLevelId });
  for (const railing of model.railings || []) for (const piece of makeRailing(railing, materials)) add(piece, { kind: 'vertical', levelId: railing.levelId });
  for (const voidItem of model.voids || []) add(makeHeightMarker(voidItem), { kind: 'dimension', levelId: 'all' });
  return { home, records };
}

export function setDisplayMode(records, mode) {
  for (const record of records) {
    const lower = record.levelId === 'lower' || record.levelId === 'all' || record.kind === 'vertical';
    const upper = record.levelId === 'upper' || record.levelId === 'all' || record.kind === 'vertical';
    if (record.kind === 'label') { record.object.visible = mode === record.levelId; continue; }
    if (mode === 'free') record.object.visible = true;
    else if (mode === 'lower') record.object.visible = lower && !record.sectionHidden;
    else if (mode === 'upper') record.object.visible = upper && !record.sectionHidden;
    else if (mode === 'section') record.object.visible = !record.sectionHidden && !(record.kind === 'wall' && record.levelId === 'upper');
    else record.object.visible = !record.sectionHidden;
  }
}

export function calculateBounds(rooms) {
  const points = rooms.flatMap((room) => room.polygon);
  return { minX: Math.min(...points.map(([x]) => x)), minZ: Math.min(...points.map(([, z]) => z)), maxX: Math.max(...points.map(([x]) => x)), maxZ: Math.max(...points.map(([, z]) => z)) };
}

export function roomElevation(model, room) { return elevation(model, room); }

function makeMaterial(item) {
  return new THREE.MeshStandardMaterial({ color: item.color, roughness: item.roughness, metalness: 0, transparent: item.opacity !== undefined, opacity: item.opacity ?? 1, side: item.opacity !== undefined ? THREE.DoubleSide : THREE.FrontSide });
}
function cloneMaterial(materials, id, fallback) { return materials.get(id)?.clone() || new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.8 }); }
function shape(polygon) { const result = new THREE.Shape(); polygon.forEach(([x, z], index) => index ? result.lineTo(x, -z) : result.moveTo(x, -z)); result.closePath(); return result; }
function levelId(item) { return item.levelId || 'lower'; }
function elevation(model, item) { if (Number.isFinite(item.elevation)) return item.elevation; return model.levels?.find((level) => level.id === levelId(item))?.elevation || 0; }

function makeFurniture(item, materials, wallMaterial, baseElevation) {
  const [width, depth, height] = item.size;
  const material = cloneMaterial(materials, item.material, '#315f4a');
  const group = new THREE.Group();
  if (item.kind === 'plant') {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.25, width * 0.34, height * 0.35, 18), new THREE.MeshStandardMaterial({ color: '#9b7452', roughness: 0.9 }));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(width * 0.55, 16, 12), material);
    pot.position.y = height * 0.18; crown.position.y = height * 0.72; group.add(pot, crown);
  } else {
    const low = ['bed', 'sofa', 'chair'].includes(item.kind);
    const baseHeight = low ? height * 0.48 : height;
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, baseHeight, depth), material);
    base.position.y = baseHeight / 2; base.castShadow = base.receiveShadow = true; group.add(base);
    if (['sofa', 'chair'].includes(item.kind)) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.55, depth * 0.16), material.clone());
      back.position.set(0, height * 0.7, depth * 0.4); back.castShadow = true; group.add(back);
    }
    if (item.kind === 'bed') {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.12, depth * 0.22), wallMaterial.clone());
      pillow.position.set(0, baseHeight + 0.08, -depth * 0.27); group.add(pillow);
    }
  }
  group.position.set(item.position[0], baseElevation + 0.05, item.position[1]);
  group.rotation.y = item.rotation;
  return group;
}

function makeStair(stair, model, materials) {
  const group = new THREE.Group();
  const from = model.levels?.find((level) => level.id === stair.fromLevelId)?.elevation || 0;
  const to = model.levels?.find((level) => level.id === stair.toLevelId)?.elevation || stair.rise;
  const dx = stair.end[0] - stair.start[0], dz = stair.end[1] - stair.start[1];
  const run = Math.hypot(dx, dz), stepRun = run / stair.steps, stepRise = (to - from) / stair.steps;
  const material = cloneMaterial(materials, stair.material, '#80664d');
  for (let index = 0; index < stair.steps; index += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(stair.width, stepRise * (index + 1), stepRun * 0.96), material.clone());
    const ratio = (index + 0.5) / stair.steps;
    mesh.position.set(stair.start[0] + dx * ratio, from + stepRise * (index + 1) / 2, stair.start[1] + dz * ratio);
    mesh.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

function makeRailing(railing, materials) {
  const pieces = [];
  for (let index = 0; index < railing.points.length - 1; index += 1) {
    const [x1, z1] = railing.points[index], [x2, z2] = railing.points[index + 1];
    const length = Math.hypot(x2 - x1, z2 - z1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(length, railing.height, 0.035), cloneMaterial(materials, railing.material, '#b8d5d3'));
    glass.position.set((x1 + x2) / 2, railing.elevation + railing.height / 2, (z1 + z2) / 2);
    glass.rotation.y = -Math.atan2(z2 - z1, x2 - x1); pieces.push(glass);
    for (const [x, z] of [[x1, z1], [x2, z2]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, railing.height, 0.045), new THREE.MeshStandardMaterial({ color: '#4e544f', roughness: 0.5 }));
      post.position.set(x, railing.elevation + railing.height / 2, z); pieces.push(post);
    }
  }
  return pieces;
}

function makeHeightMarker(voidItem) {
  const center = calculateBounds([{ polygon: voidItem.polygon }]);
  const x = center.minX + 0.22, z = center.minZ + 0.22;
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, voidItem.bottomElevation, z), new THREE.Vector3(x, voidItem.bottomElevation + voidItem.height, z)]);
  const group = new THREE.Group();
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#9b5b42' })));
  const sprite = labelSprite(`${voidItem.height.toFixed(1)} m 挑空`);
  sprite.position.set(x, voidItem.bottomElevation + voidItem.height * 0.62, z); group.add(sprite);
  return group;
}

function labelSprite(text, { width = 2.8, height = 0.7, color = '#9b5b42', font = 42 } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = 'rgba(249,248,244,.94)'; context.fillRect(0, 0, 512, 128);
  context.fillStyle = color; context.font = `600 ${font}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 64);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material); sprite.scale.set(width, height, 1); return sprite;
}
function polygonCenter(polygon) { return polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]); }
