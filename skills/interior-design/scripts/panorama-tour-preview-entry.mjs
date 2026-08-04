import * as THREE from "three";

const root = document.querySelector("[data-panorama-tour-preview]");
if (!root) throw new Error("panorama tour preview root is missing");

const state = {
  yaw: 0,
  pitch: 0,
  fov: 82,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  scene: null,
  transition: null,
};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(state.fov, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setAnimationLoop(render);
root.prepend(renderer.domElement);

const sphereGeometry = new THREE.SphereGeometry(20, 96, 64);
sphereGeometry.scale(-1, 1, 1);
const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
scene.add(new THREE.Mesh(sphereGeometry, sphereMaterial));

const hotspotLayer = root.querySelector("[data-hotspots]");
const sceneTitle = root.querySelector("[data-scene-title]");
const sceneList = root.querySelector("[data-scene-list]");
const loader = new THREE.TextureLoader();
const textures = new Map();
let manifest;

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (state.transition) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!state.dragging || state.transition) return;
  state.yaw -= (event.clientX - state.pointerX) * 0.11;
  state.pitch = THREE.MathUtils.clamp(state.pitch + (event.clientY - state.pointerY) * 0.11, -82, 82);
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
});
renderer.domElement.addEventListener("pointerup", (event) => {
  state.dragging = false;
  if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.fov = THREE.MathUtils.clamp(state.fov + event.deltaY * 0.035, 38, 100);
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
}, { passive: false });

root.querySelector("[data-action='reset']")?.addEventListener("click", () => {
  if (state.scene) setView(state.scene.initialYaw, -state.scene.initialPitch, 82);
});
root.querySelector("[data-action='fullscreen']")?.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await root.requestFullscreen();
});
addEventListener("resize", resize);
resize();

initialize();

async function initialize() {
  try {
    const response = await fetch(root.dataset.config, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`tour preview manifest failed: ${response.status}`);
    manifest = await response.json();
    buildSceneList();
    await loadScene(manifest.scenes[0]?.id);
    root.dataset.ready = "true";
  } catch (error) {
    root.dataset.error = "true";
    root.querySelector("[data-state]").textContent = "全景预览加载失败";
    console.error(error);
  }
}

function buildSceneList() {
  for (const item of manifest.scenes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title;
    button.dataset.sceneId = item.id;
    button.addEventListener("click", () => loadScene(item.id));
    sceneList.append(button);
  }
}

async function loadScene(id, arrival = null) {
  const next = manifest.scenes.find((item) => item.id === id);
  if (!next) throw new Error(`unknown preview scene: ${id}`);
  root.dataset.loading = "true";
  const texture = await loadTexture(next.image);
  if (sphereMaterial.map && sphereMaterial.map !== texture) sphereMaterial.map = null;
  sphereMaterial.map = texture;
  sphereMaterial.needsUpdate = true;
  state.scene = next;
  sceneTitle.textContent = next.title;
  setView(arrival?.yaw ?? next.initialYaw, -(arrival?.pitch ?? next.initialPitch), 82);
  buildHotspots(next);
  for (const button of sceneList.children) button.dataset.active = String(button.dataset.sceneId === id);
  root.dataset.loading = "false";
}

function loadTexture(url) {
  if (textures.has(url)) return textures.get(url);
  const pending = new Promise((resolve, reject) => loader.load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    resolve(texture);
  }, undefined, reject));
  textures.set(url, pending);
  return pending;
}

function buildHotspots(item) {
  hotspotLayer.replaceChildren();
  for (const hotspot of item.hotspots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hotspot ${hotspot.kind === "portal" ? "portal" : "waypoint"}`;
    button.innerHTML = `<span aria-hidden="true">${hotspot.kind === "portal" ? "↑" : "⌃"}</span><strong></strong>`;
    button.querySelector("strong").textContent = hotspot.label;
    button.setAttribute("aria-label", `${hotspot.label}`);
    button.dataset.ath = String(hotspot.departureAth);
    button.dataset.atv = String(hotspot.departureAtv);
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (state.transition) return;
      await transitionTo(hotspot);
    });
    hotspotLayer.append(button);
  }
}

async function transitionTo(hotspot) {
  root.dataset.transitioning = "true";
  await animateLook(hotspot.departureAth, -Math.min(8, hotspot.departureAtv), 620);
  await loadScene(hotspot.target, { yaw: hotspot.arrivalHlookat, pitch: hotspot.arrivalVlookat });
  root.dataset.transitioning = "false";
}

function animateLook(yaw, pitch, duration) {
  const start = performance.now();
  const fromYaw = state.yaw;
  const fromPitch = state.pitch;
  const deltaYaw = shortestYaw(yaw - fromYaw);
  return new Promise((resolve) => {
    state.transition = { start, duration, fromYaw, fromPitch, deltaYaw, targetPitch: pitch, resolve };
  });
}

function setView(yaw, pitch, fov = state.fov) {
  state.yaw = number(yaw, 0);
  state.pitch = THREE.MathUtils.clamp(number(pitch, 0), -82, 82);
  state.fov = fov;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function resize() {
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render(now) {
  if (state.transition) {
    const progress = Math.min(1, (now - state.transition.start) / state.transition.duration);
    const eased = progress * progress * (3 - 2 * progress);
    state.yaw = state.transition.fromYaw + state.transition.deltaYaw * eased;
    state.pitch = THREE.MathUtils.lerp(state.transition.fromPitch, state.transition.targetPitch, eased);
    if (progress >= 1) {
      const resolve = state.transition.resolve;
      state.transition = null;
      resolve();
    }
  }
  const phi = THREE.MathUtils.degToRad(90 - state.pitch);
  const theta = THREE.MathUtils.degToRad(physicalYaw(state.yaw));
  const forward = new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(forward);
  camera.updateMatrixWorld();
  positionHotspots(forward);
  renderer.render(scene, camera);
}

function positionHotspots(forward) {
  const width = root.clientWidth;
  const height = root.clientHeight;
  for (const button of hotspotLayer.children) {
    const direction = directionFor(number(button.dataset.ath, 0), -number(button.dataset.atv, 0));
    const visible = forward.dot(direction) > 0.08;
    const projected = direction.clone().multiplyScalar(10).project(camera);
    button.hidden = !visible || projected.z < -1 || projected.z > 1;
    if (!button.hidden) {
      button.style.transform = `translate(-50%,-50%) translate(${(projected.x * 0.5 + 0.5) * width}px,${(-projected.y * 0.5 + 0.5) * height}px)`;
    }
  }
}

function directionFor(yaw, pitch) {
  const phi = THREE.MathUtils.degToRad(90 - pitch);
  const theta = THREE.MathUtils.degToRad(physicalYaw(yaw));
  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
}

function shortestYaw(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function physicalYaw(logicalYaw) {
  return -logicalYaw - 90;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
