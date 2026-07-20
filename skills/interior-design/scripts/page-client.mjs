import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startProjectionFallback } from './projection-fallback.mjs';
import { buildInteriorModel, calculateBounds, roomElevation, setAnnotationMode, setDisplayMode } from './scene-geometry.mjs';

const model = JSON.parse(document.querySelector('#model').textContent);
const sourceCanvas = document.querySelector('#scene');
const initialView = ({ isometric: 'iso', interior: 'walk' })[model.camera?.initial] || model.camera?.initial || 'iso';
let currentView = initialView; let currentRoom = ''; let displayMode = model.views?.[0]?.id || 'overall'; let annotationMode = 'off'; let lightMode = model.lighting.mode || 'day'; let runtime;

try { runtime = startWebGL(sourceCanvas); }
catch {
  const canvas = document.createElement('canvas'); canvas.id = 'scene'; canvas.setAttribute('aria-label', sourceCanvas.getAttribute('aria-label')); sourceCanvas.replaceWith(canvas);
  document.querySelector('#fallback').hidden = false; runtime = startProjectionFallback(canvas, model);
}

document.querySelectorAll('[data-room]').forEach((button) => button.addEventListener('click', () => applyView(currentView, button.dataset.room || '')));
document.querySelector('#room-select').addEventListener('change', (event) => applyView(currentView, event.target.value));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => applyView(button.dataset.view, currentRoom)));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => applyMode(button.dataset.mode)));
document.querySelector('#annotation-select')?.addEventListener('change', (event) => { annotationMode = event.target.value; runtime.setAnnotations(annotationMode, currentRoom, displayMode); });
document.querySelector('#light').addEventListener('click', () => { lightMode = lightMode === 'day' ? 'evening' : 'day'; document.querySelector('#light').textContent = lightMode === 'day' ? '日间' : '傍晚'; document.body.dataset.light = lightMode; runtime.setLighting(lightMode); });
document.querySelector('#reset').addEventListener('click', () => { displayMode = model.views?.[0]?.id || 'overall'; applyView('iso', ''); syncMode(); });
applyView(initialView, ''); syncMode(); document.body.dataset.light = lightMode;
window.__interiorViewer = { applyView, applyMode, setRevealProgress: (progress) => runtime.setRevealProgress(progress), getState: () => ({ currentView, currentRoom, displayMode, annotationMode, lightMode }) };

function applyView(view, roomId) {
  currentView = view; currentRoom = roomId;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('[data-room]').forEach((button) => button.classList.toggle('active', (button.dataset.room || '') === roomId));
  document.querySelector('#room-select').value = roomId;
  runtime.update(view, roomId, displayMode);
  runtime.setAnnotations(annotationMode, roomId, displayMode);
}
function applyMode(mode) {
  displayMode = mode; syncMode();
  if (model.views) { currentRoom = ''; document.querySelector('#room-select').value = ''; runtime.update(currentView, '', mode); }
  else if (mode === 'free') runtime.update(currentView, currentRoom, 'free');
  else runtime.update(mode === 'upper' ? 'top' : mode === 'section' ? 'iso' : currentView, currentRoom, mode);
}
function syncMode() { document.body.dataset.mode = displayMode; document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === displayMode)); }

function startWebGL(canvas) {
  const bootStart = performance.now(); const lowPower = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  document.body.dataset.performance = lowPower ? 'reduced' : 'full';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.2 : 2)); renderer.shadowMap.enabled = model.lighting.shadows && !lowPower; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 140);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = false; controls.enablePan = true; controls.screenSpacePanning = true; controls.maxPolarAngle = Math.PI * 0.49;
  const bounds = model.project.bounds || calculateBounds(model.rooms); const center = new THREE.Vector3((bounds.maxX + bounds.minX) / 2, 0, (bounds.maxZ + bounds.minZ) / 2); const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const base = new THREE.Mesh(new THREE.BoxGeometry(span * 1.16, 0.18, span * 1.16), new THREE.MeshStandardMaterial({ color: '#b9bbb8', roughness: 0.94 }));
  base.position.set(center.x, -0.11, center.z); base.receiveShadow = true; scene.add(base);
  const built = buildInteriorModel(model, scene);
  const ambient = new THREE.HemisphereLight(0xffffff, 0xa9aca5, Math.max(1.2, model.lighting.ambient * 1.8));
  const sun = new THREE.DirectionalLight(0xfff4de, 3.6); sun.position.set(center.x - span, span * 1.8, center.z + span * 0.7); sun.target.position.copy(center);
  sun.castShadow = model.lighting.shadows && !lowPower; sun.shadow.mapSize.set(lowPower ? 512 : 2048, lowPower ? 512 : 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -span; sun.shadow.camera.right = sun.shadow.camera.top = span;
  const windowLight = new THREE.RectAreaLight(0xfff1d9, lowPower ? 1.2 : 3.2, span * 0.72, 4.2); windowLight.position.set(center.x, 3.4, bounds.minZ + 0.3); windowLight.lookAt(center.x, 0.8, center.z);
  const lamps = [[center.x - span * .22, 2.3, center.z], [center.x + span * .28, 2.3, center.z + span * .22]].map(([x,y,z]) => { const light = new THREE.PointLight(0xffb86a, 0, lowPower ? 5 : 8, 2); light.position.set(x,y,z); return light; });
  scene.add(ambient, sun, sun.target, windowLight, ...lamps);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  const resize = () => { const width = Math.max(1, canvas.clientWidth); const height = Math.max(1, canvas.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
  new ResizeObserver(resize).observe(canvas); resize();
  let revealFrame = 0;
  const finishReveal = () => { if (revealFrame) cancelAnimationFrame(revealFrame); revealFrame = 0; built.home.scale.y = 1; render(); };
  canvas.addEventListener('pointerdown', finishReveal, { once: true }); canvas.addEventListener('wheel', finishReveal, { once: true });
  if (model.presentation?.reveal && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const start = performance.now(); const duration = Math.max(400, Math.min(5000, model.presentation.revealDurationMs || 1600));
    const frame = (time) => { const progress = Math.min(1, (time - start) / duration); built.home.scale.y = 0.025 + 0.975 * (1 - Math.pow(1 - progress, 3)); render(); if (progress < 1) revealFrame = requestAnimationFrame(frame); else revealFrame = 0; };
    built.home.scale.y = 0.025; revealFrame = requestAnimationFrame(frame);
  }
  const setLighting = (mode) => {
    const evening = mode === 'evening'; renderer.setClearColor(evening ? 0x252722 : 0xf5f4ef, 1); scene.fog = new THREE.Fog(evening ? 0x252722 : 0xf5f4ef, 30, 64);
    ambient.color.set(evening ? 0xd8c1a7 : 0xffffff); ambient.groundColor.set(evening ? 0x4b4039 : 0xa9aca5); ambient.intensity = evening ? 1.15 : Math.max(1.2, model.lighting.ambient * 1.8);
    sun.color.set(evening ? 0xffb66e : 0xfff4de); sun.intensity = evening ? 1.3 : 3.6; windowLight.intensity = evening ? .35 : lowPower ? 1.2 : 3.2; lamps.forEach((light) => { light.intensity = evening ? (lowPower ? 7 : 12) : 0; }); renderer.toneMappingExposure = evening ? 0.84 : 1.05; render();
  };
  setLighting(lightMode); const metrics = { profile: lowPower ? 'reduced' : 'full', firstRenderMs: performance.now() - bootStart, renderSamplesMs: [], objects: scene.children.length };
  window.__interiorMetrics = metrics; let samples = 0;
  const sample = () => { const start = performance.now(); render(); metrics.renderSamplesMs.push(performance.now() - start); samples += 1; if (samples < 10) requestAnimationFrame(sample); else { metrics.avgRenderMs = metrics.renderSamplesMs.reduce((sum, value) => sum + value, 0) / metrics.renderSamplesMs.length; metrics.triangles = renderer.info.render.triangles; } };
  requestAnimationFrame(sample);
  return { setLighting, setRevealProgress(progress) { finishReveal(); built.home.scale.y = Math.max(.025, Math.min(1, progress)); render(); }, setAnnotations(category, roomId, mode) { setAnnotationMode(built.records, category, roomId, model, mode); render(); }, update(view, roomId, mode) {
    setDisplayMode(built.records, mode, model);
    const pose = viewPose(view, roomId, center, span); const direction = pose.position.clone().sub(pose.target);
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? 1 : 0);
    direction.multiplyScalar(Math.max(1, 0.82 / camera.aspect)); camera.position.copy(pose.target).add(direction); controls.target.copy(pose.target);
    controls.minDistance = roomId ? 1.4 : 3.5; controls.maxDistance = roomId ? 18 : 54; controls.update(); setAnnotationMode(built.records, annotationMode, roomId, model, mode); render();
  } };
}

function viewPose(view, roomId, center, wholeSpan) {
  const room = model.rooms.find((entry) => entry.id === roomId);
  const groupRooms = model.views?.find((entry) => entry.id === displayMode)?.roomIds?.map((id) => model.rooms.find((roomEntry) => roomEntry.id === id)).filter(Boolean);
  const roomBounds = room ? calculateBounds([room]) : groupRooms?.length && displayMode !== 'overall' ? calculateBounds(groupRooms) : null;
  const elevation = room ? roomElevation(model, room) : displayMode === 'upper' ? model.levels?.find((level) => level.id === 'upper')?.elevation || 3 : 0;
  const target = roomBounds ? new THREE.Vector3((roomBounds.maxX + roomBounds.minX) / 2, elevation + 0.7, (roomBounds.maxZ + roomBounds.minZ) / 2) : center.clone().setY(displayMode === 'upper' ? elevation + 0.2 : 1.1);
  const span = roomBounds ? Math.max(roomBounds.maxX - roomBounds.minX, roomBounds.maxZ - roomBounds.minZ, 2.5) : wholeSpan;
  if (view === 'top') return { target, position: target.clone().add(new THREE.Vector3(0, span * 1.58, 0.001)) };
  if (view === 'walk') return { target: target.clone().setY(elevation + 1.25), position: target.clone().add(new THREE.Vector3(0, 0.35, Math.max(2.4, span * 0.62))) };
  const framing = roomBounds ? 1.34 : .92;
  return { target, position: target.clone().add(new THREE.Vector3(-span * framing, span * (roomBounds ? 1.12 : .84), -span * framing)) };
}
