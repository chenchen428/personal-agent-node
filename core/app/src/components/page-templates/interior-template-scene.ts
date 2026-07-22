import * as THREE from "three";
import { createInteriorFurniture } from "./interior-template-furniture";
import { interiorBounds, interiorObjects, interiorOpenings, interiorPalette, interiorRooms, interiorWalls, type InteriorOpening, type Point3 } from "./interior-template-model";
import { createBox } from "./interior-template-three";

export type InteriorView = "iso" | "top";

export function createInteriorScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(interiorPalette.background);

  scene.add(createBox([27, 0.12, 21], "#d9dcda", [0, -0.24, 0], 1));
  for (const room of interiorRooms) scene.add(createBox(
    [room.size[0], 0.24, room.size[1]],
    room.tiled ? interiorPalette.floorAlt : interiorPalette.floor,
    [room.center[0], -0.13, room.center[2]],
    0.9
  ));
  for (const wall of interiorWalls) scene.add(createBox(wall.size, interiorPalette.wall, wall.position, 0.82));
  for (const opening of interiorOpenings) scene.add(opening.kind === "window" ? createWindow(opening) : createDoor(opening));
  addDecksAndRailings(scene);
  for (const item of interiorObjects) scene.add(createInteriorFurniture(item));

  scene.add(new THREE.AmbientLight(0xffffff, 1.75));
  const sun = new THREE.DirectionalLight(0xfffaf0, 2.35);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
  sun.shadow.camera.right = sun.shadow.camera.top = 24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 65;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd9e8ee, 0.65);
  fill.position.set(-10, 8, -6);
  scene.add(fill);
  return scene;
}

export function cameraPose(view: InteriorView) {
  const target = new THREE.Vector3(...interiorBounds.center);
  if (view === "top") return { target, position: target.clone().add(new THREE.Vector3(0.01, 29, 0.01)) };
  return { target, position: target.clone().add(new THREE.Vector3(17, 20, 20)) };
}

export function disposeInteriorScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function createDoor(opening: InteriorOpening) {
  const group = new THREE.Group();
  group.position.set(...opening.position);
  group.rotation.y = opening.rotation;
  const dark = opening.kind === "entry" ? "#383b39" : "#8f8172";
  group.add(createBox([opening.width, 2.08, 0.1], dark));
  group.add(createBox([opening.width + 0.14, 0.08, 0.16], "#4b4e4c", [0, 1.1, 0]));
  group.add(createBox([0.08, 2.2, 0.16], "#4b4e4c", [-opening.width / 2 - 0.04, 0, 0]));
  group.add(createBox([0.08, 2.2, 0.16], "#4b4e4c", [opening.width / 2 + 0.04, 0, 0]));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: "#b79a62", metalness: 0.6, roughness: 0.3 }));
  knob.position.set(opening.width * 0.34, 0.03, 0.08);
  group.add(knob);
  return group;
}

function createWindow(opening: InteriorOpening) {
  const group = new THREE.Group();
  group.position.set(...opening.position);
  group.rotation.y = opening.rotation;
  group.add(createBox([opening.width, 2.05, 0.08], "#4b4f4d"));
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(opening.width - 0.12, 1.9, 0.03),
    new THREE.MeshPhysicalMaterial({ color: "#cbd5d4", opacity: 0.42, roughness: 0.18, transparent: true })
  );
  glass.position.z = 0.05;
  group.add(glass);
  const panes = Math.max(2, Math.round(opening.width / 1.2));
  for (let index = 1; index < panes; index += 1) group.add(createBox(
    [0.055, 2.02, 0.1],
    "#4b4f4d",
    [-opening.width / 2 + (index * opening.width) / panes, 0, 0.08]
  ));
  return group;
}

function addDecksAndRailings(scene: THREE.Scene) {
  const decks: Array<{ position: Point3; size: Point3 }> = [
    { position: [-0.8, -0.02, -5.95], size: [2.8, 0.12, 1.2] },
    { position: [3.95, -0.02, -5.95], size: [3, 0.12, 1.2] },
    { position: [-0.1, -0.02, 5.95], size: [5.7, 0.12, 1.7] },
    { position: [-4.65, -0.02, 6.05], size: [2.35, 0.12, 0.65] },
    { position: [4.35, -0.02, 6.25], size: [2.9, 0.12, 0.65] },
  ];
  for (const deck of decks) scene.add(createBox(deck.size, "#b8aa93", deck.position));
  scene.add(createRailing([-0.8, 0, -6.54], 2.8));
  scene.add(createRailing([3.95, 0, -6.54], 3));
  scene.add(createRailing([-0.1, 0, 6.8], 5.7));
}

function createRailing(position: Point3, width: number) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.add(createBox([width, 0.08, 0.08], "#4b4f4d", [0, 0.92, 0]));
  const count = Math.max(3, Math.round(width / 1.2));
  for (let index = 0; index <= count; index += 1) group.add(createBox(
    [0.07, 0.96, 0.07],
    "#4b4f4d",
    [-width / 2 + (index * width) / count, 0.48, 0]
  ));
  return group;
}

export function projectLabel(position: Point3, camera: THREE.Camera, width: number, height: number) {
  const projected = new THREE.Vector3(...position).project(camera);
  return {
    visible: projected.z > -1 && projected.z < 1,
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
  };
}
