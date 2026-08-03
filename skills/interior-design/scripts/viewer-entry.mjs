import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

const model = window.__INTERIOR_MODEL__;
if (!model || !Array.isArray(model.primitives) || !Array.isArray(model.rooms)) throw new Error("Interior model data is missing");

const canvas = document.querySelector("#model-canvas");
const stage = document.querySelector("#model-stage");
const loading = document.querySelector("#viewer-loading");
const labelsLayer = document.querySelector("#model-labels");
const walkHelp = document.querySelector("#walk-help");
const hint = document.querySelector("#viewer-hint");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xe6e3dc, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe6e3dc, 22, 54);
scene.add(new THREE.HemisphereLight(0xfffbef, 0x68716d, 2.35));
const sun = new THREE.DirectionalLight(0xffefd2, 3.6);
sun.position.set(-9, 17, 11);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
scene.add(sun);

const perspective = new THREE.PerspectiveCamera(48, 1, 0.04, 120);
const orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.04, 120);
let camera = perspective;
let mode = "overview";
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.075;
orbit.screenSpacePanning = true;
orbit.minDistance = 0.25;
orbit.maxDistance = 42;
orbit.maxPolarAngle = Math.PI / 2 - 0.025;
const walk = new PointerLockControls(perspective, canvas);
const clock = new THREE.Clock();
const pressed = new Set();

const root = new THREE.Group();
const ceilings = new THREE.Group();
scene.add(root, ceilings);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const sphereGeometry = new THREE.SphereGeometry(.5, 24, 16);
const cylinderGeometry = new THREE.CylinderGeometry(.5, .5, 1, 32);
const materialCache = new Map();
const labelRecords = [];
const labeledNames = new Set();

for (const item of model.primitives) {
  if (item.kind === "floor") continue;
  const mesh = new THREE.Mesh(geometryFor(item), materialFor(item));
  mesh.name = item.id;
  mesh.userData = item;
  mesh.position.set(item.center[0] / 1000, (item.center[2] + item.size[2] / 2) / 1000, -item.center[1] / 1000);
  mesh.scale.set(item.size[0] / 1000, item.size[2] / 1000, item.size[1] / 1000);
  mesh.rotation.y = -(item.rotationDeg || 0) * Math.PI / 180;
  mesh.castShadow = !["glass", "light"].includes(item.kind);
  mesh.receiveShadow = item.kind !== "glass";
  root.add(mesh);
  if (!(["glass", "light", "door-handle"].includes(item.kind))) addEdges(mesh, item.kind);
  if (shouldLabel(item) && !labeledNames.has(item.name)) {
    labeledNames.add(item.name);
    const node = document.createElement("span");
    node.className = "model-label";
    node.textContent = item.name;
    labelsLayer.append(node);
    labelRecords.push({ node, mesh });
  }
}

for (const room of model.rooms) addRoomFloor(room);
addCeilings();
for (const point of (model.points || []).filter((entry) => entry.type === "light").slice(0, 8)) addRoomLight(point);

const bounds = new THREE.Box3().setFromObject(root);
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());
const span = Math.max(size.x, size.z, 4);
const walkBounds = { minX: bounds.min.x + 0.18, maxX: bounds.max.x - 0.18, minZ: bounds.min.z + 0.18, maxZ: bounds.max.z - 0.18 };
const views = buildInteriorViews();
let activeView = views[0] || null;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0xc7c9c4, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.07;
ground.receiveShadow = true;
scene.add(ground);

function materialFor(item) {
  const key = `${item.kind}|${item.material}|${item.color}`;
  if (materialCache.has(key)) return materialCache.get(key);
  let material;
  if (item.kind === "glass") {
    material = new THREE.MeshPhysicalMaterial({ color: item.color, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  } else {
    const metal = /frame|metal|appliance/.test(`${item.kind}|${item.material}`);
    material = new THREE.MeshStandardMaterial({ color: item.color, roughness: metal ? 0.34 : item.kind === "wall" ? 0.92 : 0.68, metalness: metal ? 0.28 : 0, emissive: item.kind === "light" ? item.color : 0x000000, emissiveIntensity: item.kind === "light" ? 1.8 : 0 });
  }
  materialCache.set(key, material);
  return material;
}

function geometryFor(item) {
  if (item.shape === "sphere" || item.kind === "door-handle") return sphereGeometry;
  if (item.kind === "light") return cylinderGeometry;
  return boxGeometry;
}

function addEdges(mesh, kind) {
  const opacity = kind === "wall" ? 0.24 : 0.16;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), new THREE.LineBasicMaterial({ color: 0x303632, transparent: true, opacity }));
  mesh.add(edge);
}

function addRoomFloor(room) {
  const shape = new THREE.Shape();
  room.polygon.forEach(([x, y], index) => index ? shape.lineTo(x / 1000, y / 1000) : shape.moveTo(x / 1000, y / 1000));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const floor = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: roomColor(room.id), roughness: 0.9, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.025;
  floor.receiveShadow = true;
  root.add(floor);
}

function addCeilings() {
  const zones = Array.isArray(model.ceilingZones) && model.ceilingZones.length
    ? model.ceilingZones
    : model.rooms.map((room) => ({ id: `ceiling-${room.id}`, polygon: room.polygon, elevation: 2720 }));
  for (const zone of zones) {
    const shape = new THREE.Shape();
    zone.polygon.forEach(([x, y], index) => index ? shape.lineTo(x / 1000, y / 1000) : shape.moveTo(x / 1000, y / 1000));
    shape.closePath();
    const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.96, side: THREE.DoubleSide }));
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = Number(zone.elevation ?? 2720) / 1000;
    ceiling.receiveShadow = true;
    ceilings.add(ceiling);
  }
}

function addRoomLight(point) {
  const light = new THREE.PointLight(0xffd7a2, 0.78, 4.8, 1.7);
  light.position.set(point.position[0] / 1000, Math.min(2.55, point.mountHeight / 1000), -point.position[1] / 1000);
  scene.add(light);
}

function roomColor(id) {
  const colors = [0xd8cdbb, 0xddd7cb, 0xcfd8d1, 0xe3d9d1, 0xd6d9d4];
  return colors[Math.abs(hashCode(id)) % colors.length];
}

function shouldLabel(item) {
  return /^(cabinet|sofa|table|bed-base|appliance|sanitary|chair|bench)$/.test(item.kind) && item.name;
}

function buildInteriorViews() {
  if (Array.isArray(model.panoramaNodes) && model.panoramaNodes.length) {
    return model.panoramaNodes.map((node) => ({
      id: node.id,
      name: node.title,
      roomId: node.roomId,
      position: toThree(node.position),
      target: toThree(node.lookAt),
    }));
  }
  const preferred = [
    { roomId: "room-living", cameraToken: "public" },
    { roomId: "room-kitchen", cameraToken: "kitchen" },
    { roomId: "room-primary", cameraToken: "primary" },
  ];
  return preferred.map(({ roomId, cameraToken }) => {
    const room = model.rooms.find((entry) => entry.id === roomId);
    if (!room) return null;
    const source = (model.cameras || []).find((entry) => entry.id.includes(cameraToken));
    if (source) return { id: roomId, name: room.name, position: toThree(source.position), target: toThree(source.target) };
    const xs = room.polygon.map((point) => point[0]);
    const ys = room.polygon.map((point) => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const position = new THREE.Vector3((minX * .7 + maxX * .3) / 1000, 1.55, -(minY * .25 + maxY * .75) / 1000);
    const target = new THREE.Vector3((minX + maxX) / 2000, 1.25, -(minY + maxY) / 2000);
    return { id: roomId, name: room.name, position, target };
  }).filter(Boolean);
}

function populateRoomButtons() {
  const container = document.querySelector("#room-buttons");
  for (const view of views) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.name;
    button.dataset.roomView = view.id;
    button.addEventListener("click", () => goToRoom(view));
    container.append(button);
  }
}

function goToRoom(view) {
  leaveWalk("interior");
  activeView = view;
  camera = perspective;
  orbit.object = perspective;
  perspective.position.copy(view.position);
  orbit.target.copy(view.target);
  perspective.lookAt(view.target);
  orbit.enabled = true;
  orbit.update();
  setCeiling(true);
  document.querySelectorAll("[data-room-view]").forEach((button) => button.setAttribute("aria-current", String(button.dataset.roomView === view.id)));
  updateModeButtons();
  resize();
}

function selectMode(next) {
  setCeiling(false);
  if (next === "overview") {
    leaveWalk("overview");
    camera = perspective;
    orbit.object = perspective;
    orbit.enabled = true;
    perspective.position.set(center.x + span * .92, Math.max(7, size.y + span * .72), center.z + span * 1.04);
    orbit.target.set(center.x, Math.min(size.y * .25, 1.2), center.z);
  } else if (next === "plan") {
    leaveWalk("plan");
    camera = orthographic;
    orbit.object = orthographic;
    orbit.enabled = true;
    orthographic.position.set(center.x, Math.max(18, size.y + 12), center.z);
    orthographic.up.set(0, 0, -1);
    orbit.target.set(center.x, 0, center.z);
  }
  camera.lookAt(orbit.target);
  orbit.update();
  document.querySelectorAll("[data-room-view]").forEach((button) => button.removeAttribute("aria-current"));
  updateModeButtons();
  resize();
}

function enterWalk() {
  if (!["interior", "walk"].includes(mode)) goToRoom(activeView || views[0]);
  mode = "walk";
  document.body.dataset.viewMode = "walk";
  camera = perspective;
  orbit.object = perspective;
  orbit.target.copy(activeView?.target ?? center);
  orbit.enabled = true;
  setCeiling(true);
  updateModeButtons();
  try { walk.lock(); } catch { walkHelp.hidden = false; }
}

function leaveWalk(next = "overview") {
  mode = next;
  document.body.dataset.viewMode = next;
  if (walk.isLocked) walk.unlock();
  walkHelp.hidden = true;
  pressed.clear();
}

function resetView() {
  if (mode === "plan") selectMode("plan");
  else if (mode === "interior" && activeView) goToRoom(activeView);
  else if (mode === "walk" && activeView) { goToRoom(activeView); enterWalk(); }
  else selectMode("overview");
}

function setCeiling(visible) {
  ceilings.visible = visible;
  document.body.dataset.ceiling = visible ? "visible" : "hidden";
  document.querySelector("[data-action='ceiling']").setAttribute("aria-pressed", String(visible));
}

function updateModeButtons() {
  document.body.dataset.viewMode = mode;
  document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === mode)));
  hint.textContent = mode === "plan" ? "拖动平移 · 滚轮缩放" : mode === "interior" ? "拖动观察 · 点击“进入室内”开始漫游" : "拖动旋转 · 滚轮缩放 · 也可从左侧直接进入房间";
}

function resize() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(8_400_000 / (width * height)), 2);
  renderer.setPixelRatio(Math.max(.75, dpr));
  renderer.setSize(width, height, false);
  perspective.aspect = width / height;
  perspective.updateProjectionMatrix();
  const half = span * .64;
  orthographic.left = -half * width / height;
  orthographic.right = half * width / height;
  orthographic.top = half;
  orthographic.bottom = -half;
  orthographic.updateProjectionMatrix();
}

function updateLabels() {
  const rect = stage.getBoundingClientRect();
  const visible = document.body.dataset.labels === "visible" && mode !== "walk";
  labelsLayer.hidden = !visible;
  if (!visible) return;
  for (const record of labelRecords) {
    const point = record.mesh.position.clone();
    point.y += record.mesh.scale.y * .62;
    point.project(camera);
    const inFrame = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.08 && Math.abs(point.y) < 1.08;
    record.node.hidden = !inFrame;
    if (inFrame) record.node.style.transform = `translate(${(point.x * .5 + .5) * rect.width}px, ${(-point.y * .5 + .5) * rect.height}px)`;
  }
}

function updateWalk(delta) {
  if (mode !== "walk") return;
  const speed = 2.1 * delta;
  if (walk.isLocked) {
    if (pressed.has("KeyW") || pressed.has("ArrowUp")) walk.moveForward(speed);
    if (pressed.has("KeyS") || pressed.has("ArrowDown")) walk.moveForward(-speed);
    if (pressed.has("KeyA") || pressed.has("ArrowLeft")) walk.moveRight(-speed);
    if (pressed.has("KeyD") || pressed.has("ArrowRight")) walk.moveRight(speed);
  } else {
    const forward = new THREE.Vector3();
    perspective.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = new THREE.Vector3();
    if (pressed.has("KeyW") || pressed.has("ArrowUp")) movement.addScaledVector(forward, speed);
    if (pressed.has("KeyS") || pressed.has("ArrowDown")) movement.addScaledVector(forward, -speed);
    if (pressed.has("KeyA") || pressed.has("ArrowLeft")) movement.addScaledVector(right, -speed);
    if (pressed.has("KeyD") || pressed.has("ArrowRight")) movement.addScaledVector(right, speed);
    perspective.position.add(movement);
    orbit.target.add(movement);
  }
  perspective.position.x = THREE.MathUtils.clamp(perspective.position.x, walkBounds.minX, walkBounds.maxX);
  perspective.position.z = THREE.MathUtils.clamp(perspective.position.z, walkBounds.minZ, walkBounds.maxZ);
  perspective.position.y = 1.55;
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => selectMode(button.dataset.view)));
document.querySelector("[data-action='walk']").addEventListener("click", () => mode === "walk" ? selectMode("overview") : enterWalk());
document.querySelector("[data-action='ceiling']").addEventListener("click", () => setCeiling(!ceilings.visible));
document.querySelector("[data-action='reset']").addEventListener("click", resetView);
document.querySelector("[data-action='resume-walk']").addEventListener("click", enterWalk);
document.querySelector("[data-action='exit-walk']").addEventListener("click", () => selectMode("overview"));
canvas.addEventListener("click", () => { if (mode === "walk" && !walk.isLocked) enterWalk(); });
walk.addEventListener("lock", () => { walkHelp.hidden = true; orbit.enabled = false; canvas.focus(); });
walk.addEventListener("unlock", () => { if (mode === "walk") { walkHelp.hidden = false; orbit.enabled = true; } });
window.addEventListener("keydown", (event) => { if (/^(Key[WASD]|Arrow)/.test(event.code)) { pressed.add(event.code); if (mode === "walk") event.preventDefault(); } });
window.addEventListener("keyup", (event) => pressed.delete(event.code));
window.addEventListener("resize", resize);

populateRoomButtons();
setCeiling(false);
selectMode("overview");
resize();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), .05);
  if (mode !== "walk") orbit.update();
  updateWalk(delta);
  renderer.render(scene, camera);
  updateLabels();
  if (loading && !loading.hidden) loading.hidden = true;
});

function toThree([x, y, z]) { return new THREE.Vector3(x / 1000, z / 1000, -y / 1000); }
function hashCode(value) { return [...String(value)].reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0); }
