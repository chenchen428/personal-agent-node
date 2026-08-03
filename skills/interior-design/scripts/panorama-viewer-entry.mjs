import * as THREE from "three";

const root = document.querySelector("[data-panorama-viewer]");
const params = new URLSearchParams(location.search);
const image = params.get("image");
const initial = {
  yaw: number(params.get("yaw"), 0),
  pitch: number(params.get("pitch"), 0),
  fov: number(params.get("fov"), 82),
};
const state = { ...initial, dragging: false, pointerX: 0, pointerY: 0 };

if (!root || !image) throw new Error("panorama viewer requires an image query parameter");
document.title = params.get("title") || "实景全景查看";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(state.fov, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setAnimationLoop(render);
root.prepend(renderer.domElement);

const geometry = new THREE.SphereGeometry(20, 96, 64);
geometry.scale(-1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

new THREE.TextureLoader().load(
  image,
  (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    material.map = texture;
    material.needsUpdate = true;
    root.dataset.ready = "true";
  },
  undefined,
  () => { root.dataset.error = "true"; },
);

renderer.domElement.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  state.yaw -= (event.clientX - state.pointerX) * 0.11;
  state.pitch = THREE.MathUtils.clamp(state.pitch + (event.clientY - state.pointerY) * 0.11, -82, 82);
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
});
renderer.domElement.addEventListener("pointerup", (event) => {
  state.dragging = false;
  renderer.domElement.releasePointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.fov = THREE.MathUtils.clamp(state.fov + event.deltaY * 0.035, 38, 100);
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
}, { passive: false });

root.querySelector("[data-action='reset']")?.addEventListener("click", () => {
  Object.assign(state, initial);
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
});
root.querySelector("[data-action='fullscreen']")?.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await root.requestFullscreen();
});

addEventListener("resize", resize);
resize();

function resize() {
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render() {
  const phi = THREE.MathUtils.degToRad(90 - state.pitch);
  const theta = THREE.MathUtils.degToRad(state.yaw);
  camera.lookAt(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
  renderer.render(scene, camera);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
