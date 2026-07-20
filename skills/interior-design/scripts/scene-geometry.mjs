import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeFurniture } from './furniture-geometry.mjs';

export function buildInteriorModel(model, scene) {
  const materials = new Map(model.materials.map((item) => [item.id, makeMaterial(item)]));
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#eeeae3', roughness: 0.86 });
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
  const walls = new Map(model.walls.map((wall) => [wall.id, wall]));
  for (const opening of model.openings) for (const object of makeOpening(opening, walls.get(opening.wallId))) add(object, { kind: 'opening', levelId: levelId(walls.get(opening.wallId) || {}), roomId: opening.roomId });
  for (const item of model.furniture) add(makeFurniture(item, materials, wallMaterial, elevation(model, item)), { kind: 'furniture', levelId: levelId(item), roomId: item.roomId, itemId: item.id });
  for (const stair of model.stairs || []) add(makeStair(stair, model, materials), { kind: 'vertical', levelId: stair.toLevelId });
  for (const railing of model.railings || []) for (const piece of makeRailing(railing, materials)) add(piece, { kind: 'vertical', levelId: railing.levelId });
  for (const voidItem of model.voids || []) add(makeHeightMarker(voidItem), { kind: 'dimension', levelId: 'all' });
  for (const route of model.circulationPaths || []) add(makeRoute(route), { kind: 'path', levelId: 'all' });
  for (const annotation of model.annotations || []) {
    const label = labelSprite(annotation.text, { width: Math.min(2.05, Math.max(.9, annotation.text.length * .11)), height: .26, color: annotation.evidence === 'estimated' ? '#9a5546' : '#294f45', font: 25 });
    label.position.set(annotation.position[0], .34, annotation.position[1]); label.visible = false;
    add(label, { kind: 'annotation', levelId: 'all', roomId: annotation.roomId, annotationCategory: annotation.category });
  }
  return { home, records };
}

export function setDisplayMode(records, mode, model) {
  const designView = model?.views?.find((view) => view.id === mode);
  if (designView) {
    const visibleRooms = new Set(designView.roomIds);
    const visibleFurniture = designView.furnitureIds ? new Set(designView.furnitureIds) : null;
    for (const record of records) {
      if (record.kind === 'path') record.object.visible = designView.showCirculation === true;
      else if (record.kind === 'wall') record.object.visible = mode === 'overall' && !record.sectionHidden;
      else if (record.kind === 'label') record.object.visible = mode !== 'overall' && visibleRooms.has(record.roomId);
      else if (record.kind === 'furniture' && visibleFurniture) record.object.visible = visibleFurniture.has(record.object.userData?.itemId);
      else if (record.roomId) record.object.visible = visibleRooms.has(record.roomId);
      else record.object.visible = mode === 'overall';
    }
    return;
  }
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

export function setAnnotationMode(records, category, roomId = '', model, displayMode) {
  const viewShowsRoutes = model?.views?.find((view) => view.id === displayMode)?.showCirculation === true;
  for (const record of records) {
    if (record.kind === 'annotation') record.object.visible = category !== 'off' && record.annotationCategory === category && (!roomId || !record.roomId || record.roomId === roomId);
    if (record.kind === 'path') record.object.visible = category === 'circulation' || (category === 'off' && viewShowsRoutes);
  }
}

export function calculateBounds(rooms) {
  const points = rooms.flatMap((room) => room.polygon);
  return { minX: Math.min(...points.map(([x]) => x)), minZ: Math.min(...points.map(([, z]) => z)), maxX: Math.max(...points.map(([x]) => x)), maxZ: Math.max(...points.map(([, z]) => z)) };
}

export function roomElevation(model, room) { return elevation(model, room); }

function makeMaterial(item) {
  const texture = item.pattern ? proceduralTexture(item.pattern, item.color) : null;
  return new THREE.MeshStandardMaterial({ color: item.color, map: texture, bumpMap: texture, bumpScale: item.pattern === 'wood' ? .018 : .01, roughness: item.roughness, metalness: item.metalness || 0, transparent: item.opacity !== undefined, opacity: item.opacity ?? 1, side: item.opacity !== undefined ? THREE.DoubleSide : THREE.FrontSide });
}
function cloneMaterial(materials, id, fallback) { return materials.get(id)?.clone() || new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.8 }); }
function shape(polygon) { const result = new THREE.Shape(); polygon.forEach(([x, z], index) => index ? result.lineTo(x, -z) : result.moveTo(x, -z)); result.closePath(); return result; }
function levelId(item) { return item.levelId || 'lower'; }
function elevation(model, item) { if (Number.isFinite(item.elevation)) return item.elevation; return model.levels?.find((level) => level.id === levelId(item))?.elevation || 0; }

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

function makeRoute(route) {
  const group = new THREE.Group();
  const points = route.points.map(([x, z]) => new THREE.Vector3(x, 0.09, z));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: route.color })));
  for (const point of points) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), new THREE.MeshBasicMaterial({ color: route.color, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.copy(point); group.add(marker);
  }
  return group;
}

function makeOpening(opening, wall) {
  if (!wall) return [];
  const [x1,z1]=wall.from,[x2,z2]=wall.to; const angle=-Math.atan2(z2-z1,x2-x1); const x=x1+(x2-x1)*opening.offset,z=z1+(z2-z1)*opening.offset; const group=new THREE.Group();
  const frame=new THREE.MeshStandardMaterial({color:'#3f4641',roughness:.42,metalness:.48}); const glass=new THREE.MeshPhysicalMaterial({color:'#b8d5d3',roughness:.08,transparent:true,opacity:.3,transmission:.45});
  if(opening.kind==='window'){
    const pane=new THREE.Mesh(new THREE.BoxGeometry(opening.width,opening.height,.035),glass); pane.position.y=opening.height/2+.18; group.add(pane);
    for(const [px,py,w,h] of [[-opening.width/2,opening.height/2+.18,.045,opening.height],[opening.width/2,opening.height/2+.18,.045,opening.height],[0,.18,opening.width,.045],[0,opening.height+.18,opening.width,.045],[0,opening.height/2+.18,.035,opening.height]]){const piece=new THREE.Mesh(new THREE.BoxGeometry(w,h,.06),frame); piece.position.set(px,py,0); group.add(piece);}
  } else { const leaf=new THREE.Mesh(new RoundedBoxGeometry(opening.width,opening.height,.055,2,.025),new THREE.MeshStandardMaterial({color:'#755b49',roughness:.7})); leaf.position.y=opening.height/2; group.add(leaf); }
  group.position.set(x,0,z); group.rotation.y=angle; return [group];
}

function proceduralTexture(pattern, color) {
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=128; const context=canvas.getContext('2d'); context.fillStyle=color; context.fillRect(0,0,128,128);
  const seed=(x,y)=>((x*17+y*31)%23)/23;
  if(pattern==='wood'){for(let y=0;y<128;y+=16){context.fillStyle=`rgba(55,35,22,${.06+seed(y,3)*.05})`; context.fillRect(0,y,128,2); for(let x=0;x<128;x+=32){context.beginPath(); context.ellipse(x+seed(x,y)*18,y+8,22,3,0,0,Math.PI*2); context.strokeStyle='rgba(255,240,220,.08)'; context.stroke();}}}
  else if(pattern==='stone'){for(let i=0;i<180;i+=1){const x=(i*47)%128,y=(i*83)%128,r=.4+(i%3)*.35; context.fillStyle=i%2?'rgba(255,255,255,.09)':'rgba(55,55,50,.07)'; context.fillRect(x,y,r,r);}}
  else if(pattern==='fabric'){for(let y=0;y<128;y+=3)for(let x=0;x<128;x+=3){context.fillStyle=`rgba(255,255,255,${.025+seed(x,y)*.035})`; context.fillRect(x,y,1,1);}}
  const texture=new THREE.CanvasTexture(canvas); texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.repeat.set(pattern==='wood'?3:5,pattern==='wood'?6:5); texture.colorSpace=THREE.SRGBColorSpace; return texture;
}

function labelSprite(text, { width = 2.8, height = 0.7, color = '#9b5b42', font = 42 } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = 'rgba(249,248,244,.94)'; context.fillRect(0, 0, 512, 128);
  context.fillStyle = color; context.font = `600 ${font}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 64);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material); sprite.scale.set(width, height, 1); return sprite;
}
function polygonCenter(polygon) { return polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]); }
