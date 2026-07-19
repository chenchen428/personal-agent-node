import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const model = JSON.parse(document.querySelector('#model').textContent);
const sourceCanvas = document.querySelector('#scene');
const initialView = ({ isometric: 'iso', interior: 'walk' })[model.camera?.initial] || model.camera?.initial || 'iso';
let currentView = initialView;
let currentRoom = '';
let runtime;

try {
  runtime = startWebGL(sourceCanvas);
} catch {
  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  canvas.setAttribute('aria-label', sourceCanvas.getAttribute('aria-label'));
  sourceCanvas.replaceWith(canvas);
  document.querySelector('#fallback').hidden = false;
  runtime = startProjectionFallback(canvas);
}

document.querySelectorAll('[data-room]').forEach((button) => button.addEventListener('click', () => apply(currentView, button.dataset.room || '')));
document.querySelector('#room-select').addEventListener('change', (event) => apply(currentView, event.target.value));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => apply(button.dataset.view, currentRoom)));
document.querySelector('#reset').addEventListener('click', () => apply('iso', ''));
apply(initialView, '');

function apply(view, roomId) {
  currentView = view;
  currentRoom = roomId;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('[data-room]').forEach((button) => button.classList.toggle('active', (button.dataset.room || '') === roomId));
  document.querySelector('#room-select').value = roomId;
  runtime.update(view, roomId);
}

function startWebGL(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = model.lighting.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0xf5f4ef, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf5f4ef, 28, 60);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  const bounds = model.project.bounds || calculateBounds(model.rooms);
  const center = new THREE.Vector3((bounds.maxX + bounds.minX) / 2, 0, (bounds.maxZ + bounds.minZ) / 2);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const materials = new Map(model.materials.map((item) => [item.id, new THREE.MeshStandardMaterial({ color: item.color, roughness: item.roughness, metalness: 0 })]));
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#f3f1eb', roughness: 0.94 });
  const home = new THREE.Group();
  scene.add(home);

  const base = new THREE.Mesh(new THREE.BoxGeometry(span * 1.12, 0.2, span * 1.12), new THREE.MeshStandardMaterial({ color: '#b9bbb8', roughness: 0.94 }));
  base.position.set(center.x, -0.12, center.z);
  base.receiveShadow = true;
  home.add(base);
  for (const room of model.rooms) {
    const shape = new THREE.Shape(room.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), materials.get(room.material)?.clone() || new THREE.MeshStandardMaterial({ color: '#c9a77b', roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    home.add(floor);
  }
  for (const wall of model.walls) {
    const [x1, z1] = wall.from, [x2, z2] = wall.to;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wall.height, wall.thickness), wallMaterial.clone());
    mesh.position.set((x1 + x2) / 2, wall.height / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow = mesh.receiveShadow = true;
    home.add(mesh);
  }
  for (const item of model.furniture) home.add(makeFurniture(item, materials, wallMaterial));

  const ambient = new THREE.HemisphereLight(0xffffff, 0xa9aca5, Math.max(1.2, model.lighting.ambient * 1.8));
  const sun = new THREE.DirectionalLight(0xfff4de, 3.6);
  sun.position.set(center.x - span, span * 1.8, center.z + span * 0.7);
  sun.target.position.copy(center);
  sun.castShadow = model.lighting.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
  sun.shadow.camera.right = sun.shadow.camera.top = span;
  scene.add(ambient, sun, sun.target);

  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  return { update(view, roomId) {
    const pose = viewPose(view, roomId, center, span);
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    controls.minDistance = roomId ? 1.4 : 3.5;
    controls.maxDistance = roomId ? 16 : 46;
    controls.update();
    render();
  } };
}

function viewPose(view, roomId, center, wholeSpan) {
  const room = model.rooms.find((entry) => entry.id === roomId);
  const roomBounds = room ? calculateBounds([room]) : null;
  const target = roomBounds
    ? new THREE.Vector3((roomBounds.maxX + roomBounds.minX) / 2, 0.7, (roomBounds.maxZ + roomBounds.minZ) / 2)
    : center.clone().setY(0.4);
  const span = roomBounds ? Math.max(roomBounds.maxX - roomBounds.minX, roomBounds.maxZ - roomBounds.minZ, 2.5) : wholeSpan;
  if (view === 'top') return { target, position: target.clone().add(new THREE.Vector3(0.01, span * 1.45, 0.01)) };
  if (view === 'walk') return { target: target.clone().setY(1), position: target.clone().add(new THREE.Vector3(0, 1.55, Math.max(2.4, span * 0.62))) };
  return { target, position: target.clone().add(new THREE.Vector3(span * 0.88, span * 0.75, span * 0.88)) };
}

function makeFurniture(item, materials, wallMaterial) {
  const [width, depth, height] = item.size;
  const material = materials.get(item.material)?.clone() || new THREE.MeshStandardMaterial({ color: '#315f4a', roughness: 0.72 });
  const group = new THREE.Group();
  if (item.kind === 'plant') {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.25, width * 0.34, height * 0.35, 18), new THREE.MeshStandardMaterial({ color: '#9b7452', roughness: 0.9 }));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(width * 0.55, 16, 12), material);
    pot.position.y = height * 0.18;
    crown.position.y = height * 0.72;
    group.add(pot, crown);
  } else {
    const low = ['bed', 'sofa', 'chair'].includes(item.kind);
    const baseHeight = low ? height * 0.48 : height;
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, baseHeight, depth), material);
    base.position.y = baseHeight / 2;
    base.castShadow = base.receiveShadow = true;
    group.add(base);
    if (['sofa', 'chair'].includes(item.kind)) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.55, depth * 0.16), material.clone());
      back.position.set(0, height * 0.7, depth * 0.4);
      back.castShadow = true;
      group.add(back);
    }
    if (item.kind === 'bed') {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.12, depth * 0.22), wallMaterial.clone());
      pillow.position.set(0, baseHeight + 0.08, -depth * 0.27);
      group.add(pillow);
    }
  }
  group.position.set(item.position[0], 0.05, item.position[1]);
  group.rotation.y = item.rotation;
  return group;
}

function startProjectionFallback(canvas) {
  const ctx = canvas.getContext('2d');
  let angle = -0.72;
  let zoom = 1;
  let focus = '';
  let dragging = false;
  let lastX = 0;
  const bounds = model.project.bounds || calculateBounds(model.rooms);
  const render = () => {
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f5f4ef'; ctx.fillRect(0, 0, width, height);
    const room = model.rooms.find((entry) => entry.id === focus);
    const fit = room ? calculateBounds([room]) : bounds;
    const span = Math.max(fit.maxX - fit.minX, fit.maxZ - fit.minZ, 2);
    const scale = Math.min(width, height) / span * 0.54 * zoom;
    const cx = (fit.maxX + fit.minX) / 2, cz = (fit.maxZ + fit.minZ) / 2;
    const project = ([x, z], y = 0) => {
      const dx = x - cx, dz = z - cz;
      const rx = dx * Math.cos(angle) - dz * Math.sin(angle);
      const rz = dx * Math.sin(angle) + dz * Math.cos(angle);
      return [width / 2 + rx * scale, height / 2 + (rz * 0.42 - y * 0.72) * scale];
    };
    for (const entry of model.rooms) {
      const points = entry.polygon.map((point) => project(point));
      ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = model.materials.find((material) => material.id === entry.material)?.color || '#c9a77b'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#f3f1eb'; ctx.stroke();
    }
    for (const wall of model.walls) {
      const a = project(wall.from, wall.height * 0.7), b = project(wall.to, wall.height * 0.7);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineWidth = Math.max(3, wall.thickness * scale); ctx.strokeStyle = '#f3f1eb'; ctx.stroke();
    }
    for (const item of model.furniture) {
      const [x, y] = project(item.position, item.size[2] * 0.5);
      ctx.fillStyle = model.materials.find((material) => material.id === item.material)?.color || '#315f4a';
      ctx.fillRect(x - item.size[0] * scale * 0.22, y - item.size[1] * scale * 0.12, item.size[0] * scale * 0.44, item.size[1] * scale * 0.24);
    }
  };
  new ResizeObserver(render).observe(canvas);
  canvas.addEventListener('pointerdown', (event) => { dragging = true; lastX = event.clientX; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!dragging) return; angle += (event.clientX - lastX) * 0.012; lastX = event.clientX; render(); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom = Math.max(0.65, Math.min(2.2, zoom - event.deltaY * 0.001)); render(); }, { passive: false });
  render();
  return { update(view, roomId) { focus = roomId; if (view === 'top') angle = 0; else if (view === 'walk') angle = -1.25; render(); } };
}

function calculateBounds(rooms) {
  const points = rooms.flatMap((room) => room.polygon);
  return { minX: Math.min(...points.map((point) => point[0])), minZ: Math.min(...points.map((point) => point[1])), maxX: Math.max(...points.map((point) => point[0])), maxZ: Math.max(...points.map((point) => point[1])) };
}
