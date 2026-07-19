import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const model = JSON.parse(document.querySelector('#model').textContent);
const canvas = document.querySelector('#scene');
const fallback = document.querySelector('#fallback');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
} catch {
  fallback.hidden = false;
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = model.lighting.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0xf7f8f6, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf7f8f6, 26, 60);
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 45;

const bounds = model.project.bounds || calculateBounds(model.rooms);
const center = new THREE.Vector3((bounds.maxX + bounds.minX) / 2, 0, (bounds.maxZ + bounds.minZ) / 2);
const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
const schemes = {
  warm: { floor: '#c9a77b', wall: '#f3f1eb', stone: '#aaa49c', accent: '#315f4a' },
  stone: { floor: '#aaa49c', wall: '#f5f3ef', stone: '#7e7d79', accent: '#7b5d46' },
  green: { floor: '#b99670', wall: '#f0f1ec', stone: '#a4a49e', accent: '#274c3b' },
};
const materialsById = new Map(model.materials.map((item) => [item.id, new THREE.MeshStandardMaterial({ color: item.color, roughness: item.roughness, metalness: 0 })]));
const floorMaterial = new THREE.MeshStandardMaterial({ color: schemes.warm.floor, roughness: 0.78 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: schemes.warm.wall, roughness: 0.9 });
const accentMaterial = new THREE.MeshStandardMaterial({ color: schemes.warm.accent, roughness: 0.7 });
const floorGroup = new THREE.Group();
const wallGroup = new THREE.Group();
const furnitureGroup = new THREE.Group();
scene.add(floorGroup, wallGroup, furnitureGroup);

for (const room of model.rooms) {
  const shape = new THREE.Shape(room.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial.clone());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.receiveShadow = true;
  mesh.userData.roomId = room.id;
  floorGroup.add(mesh);
}
for (const wall of model.walls) {
  const [x1, z1] = wall.from, [x2, z2] = wall.to;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wall.height, wall.thickness), wallMaterial.clone());
  mesh.position.set((x1 + x2) / 2, wall.height / 2, (z1 + z2) / 2);
  mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  mesh.castShadow = mesh.receiveShadow = true;
  wallGroup.add(mesh);
}
for (const item of model.furniture) furnitureGroup.add(makeFurniture(item));

const ambient = new THREE.HemisphereLight(0xffffff, 0xbfc2ba, model.lighting.ambient);
const sun = new THREE.DirectionalLight(0xfff5df, 3.4);
sun.position.set(center.x - span, span * 1.7, center.z - span * 0.5);
sun.target.position.copy(center);
sun.castShadow = model.lighting.shadows;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
sun.shadow.camera.right = sun.shadow.camera.top = span;
scene.add(ambient, sun, sun.target);

let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let free = !playing;
let elapsed = playing ? 0 : totalDuration();
let last = performance.now();
setView('iso', false);
if (!playing) finishBuild();
updatePlay();
controls.addEventListener('start', () => { free = true; playing = false; updatePlay(); });
document.querySelector('#play').addEventListener('click', () => { playing = !playing; free = false; updatePlay(); });
document.querySelector('#replay').addEventListener('click', () => { elapsed = 0; playing = true; free = false; updatePlay(); });
document.querySelector('#free').addEventListener('click', () => { playing = false; free = true; finishBuild(); updatePlay(); });
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { playing = false; free = true; finishBuild(); setView(button.dataset.view, true); updatePlay(); }));
document.querySelector('#scheme').addEventListener('change', (event) => applyScheme(event.target.value));
document.querySelector('#light').addEventListener('click', toggleLight);
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

function frame(now) {
  const delta = Math.min(now - last, 50);
  last = now;
  if (playing) elapsed = (elapsed + delta) % totalDuration();
  if (!free) animateTimeline(elapsed);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function animateTimeline(time) {
  const growth = model.camera.segments[0]?.durationMs || 6500;
  const floorT = clamp(time / (growth * 0.2));
  const wallT = clamp((time - growth * 0.18) / (growth * 0.28));
  const materialT = clamp((time - growth * 0.44) / (growth * 0.2));
  const furnitureT = clamp((time - growth * 0.61) / (growth * 0.36));
  floorGroup.scale.set(1, floorT, 1);
  floorGroup.children.forEach((mesh) => { mesh.material.opacity = 0.18 + floorT * 0.82; mesh.material.transparent = floorT < 1; });
  wallGroup.scale.y = ease(wallT);
  wallGroup.children.forEach((mesh) => { mesh.material.color.lerp(new THREE.Color(schemes.warm.wall), materialT); });
  furnitureGroup.children.forEach((mesh, index) => { const t = clamp(furnitureT * 1.4 - index / Math.max(1, furnitureGroup.children.length) * 0.4); mesh.scale.setScalar(ease(t)); mesh.visible = t > 0; });
  if (time > growth) cameraTour(time - growth, growth);
  const progress = clamp(time / totalDuration());
  document.querySelector('#progress').style.width = `${progress * 100}%`;
  document.querySelector('#time').value = `${Math.round(progress * 100)}%`;
  document.querySelector('#stage').textContent = stageLabel(time, growth);
}

function cameraTour(time, growth) {
  const segments = model.camera.segments.slice(1);
  let cursor = 0;
  for (const segment of segments) {
    if (time <= cursor + segment.durationMs) {
      const t = ease(clamp((time - cursor) / segment.durationMs));
      const start = viewPose(segment.kind === 'push' ? 'iso' : segment.kind === 'lateral' ? 'side' : 'detail');
      const end = viewPose(segment.kind === 'push' ? 'push' : segment.kind === 'lateral' ? 'lateral' : 'detail-close');
      camera.position.lerpVectors(start.position, end.position, t);
      controls.target.lerpVectors(start.target, end.target, t);
      return;
    }
    cursor += segment.durationMs;
  }
}

function makeFurniture(item) {
  const [width, depth, height] = item.size;
  const material = materialsById.get(item.material)?.clone() || accentMaterial.clone();
  if (['plant', 'toilet', 'table-round'].includes(item.kind)) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2, height, 24), material);
    return place(mesh, item, height);
  }
  const group = new THREE.Group();
  const baseHeight = ['bed', 'sofa'].includes(item.kind) ? height * 0.45 : height;
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, baseHeight, depth), material);
  base.position.y = baseHeight / 2;
  base.castShadow = base.receiveShadow = true;
  group.add(base);
  if (item.kind === 'bed') {
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.12, depth * 0.22), wallMaterial.clone());
    pillow.position.set(0, baseHeight + 0.07, -depth * 0.27);
    group.add(pillow);
  } else if (item.kind === 'sofa') {
    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.52, depth * 0.18), material.clone());
    back.position.set(0, height * 0.68, -depth * 0.4);
    group.add(back);
  }
  group.position.set(item.position[0], 0, item.position[1]);
  group.rotation.y = item.rotation;
  group.userData.itemId = item.id;
  return group;
}
function place(mesh, item, height) { mesh.position.set(item.position[0], height / 2, item.position[1]); mesh.rotation.y = item.rotation; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.itemId = item.id; return mesh; }
function applyScheme(name) { const scheme = schemes[name] || schemes.warm; floorGroup.children.forEach((mesh) => mesh.material.color.set(scheme.floor)); wallGroup.children.forEach((mesh) => mesh.material.color.set(scheme.wall)); furnitureGroup.traverse((mesh) => { if (mesh.isMesh && mesh.material === accentMaterial) mesh.material.color.set(scheme.accent); }); }
function toggleLight(event) { const evening = event.currentTarget.textContent === '日间'; event.currentTarget.textContent = evening ? '傍晚' : '日间'; ambient.intensity = evening ? 0.55 : model.lighting.ambient; ambient.color.set(evening ? 0x9da7c9 : 0xffffff); sun.color.set(evening ? 0xffad73 : 0xfff5df); sun.intensity = evening ? 2.2 : 3.4; renderer.toneMappingExposure = evening ? 0.82 : 1.05; }
function finishBuild() { floorGroup.scale.set(1, 1, 1); wallGroup.scale.y = 1; furnitureGroup.children.forEach((mesh) => { mesh.visible = true; mesh.scale.setScalar(1); }); }
function setView(name, smooth) { const pose = viewPose(name); if (smooth) { camera.position.copy(pose.position); controls.target.copy(pose.target); } else { camera.position.copy(pose.position); controls.target.copy(pose.target); } controls.update(); }
function viewPose(name) {
  const distance = span * 1.35;
  const target = center.clone().setY(name.startsWith('detail') ? 0.8 : 0.4);
  const poses = {
    iso: [distance, distance * 0.9, distance], top: [0.01, distance * 1.45, 0.01], walk: [0, 1.6, distance * 0.7],
    side: [-distance, distance * 0.7, distance * 0.5], push: [distance * 0.72, distance * 0.58, distance * 0.72],
    lateral: [distance * 0.85, distance * 0.66, -distance * 0.45], detail: [distance * 0.6, distance * 0.48, distance * 0.6],
    'detail-close': [distance * 0.34, distance * 0.3, distance * 0.34],
  };
  const offset = poses[name] || poses.iso;
  return { position: target.clone().add(new THREE.Vector3(...offset)), target };
}
function resize() { const width = canvas.clientWidth, height = canvas.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); }
function totalDuration() { return model.camera.segments.reduce((sum, segment) => sum + segment.durationMs, 0); }
function stageLabel(time, growth) { if (time < growth * .2) return '地面出现'; if (time < growth * .46) return '墙体升起'; if (time < growth * .64) return '材质铺开'; if (time < growth) return '家具入场'; const after = time - growth; const cameraSegments = model.camera.segments.slice(1); let cursor = 0; for (const segment of cameraSegments) { cursor += segment.durationMs; if (after < cursor) return segment.label; } return '自由查看'; }
function updatePlay() { document.querySelector('#play').textContent = playing ? '暂停' : '播放'; }
function calculateBounds(rooms) { const points = rooms.flatMap((room) => room.polygon); return { minX: Math.min(...points.map((p) => p[0])), minZ: Math.min(...points.map((p) => p[1])), maxX: Math.max(...points.map((p) => p[0])), maxZ: Math.max(...points.map((p) => p[1])) }; }
function clamp(value) { return Math.max(0, Math.min(1, value)); }
function ease(value) { return 1 - Math.pow(1 - value, 3); }
