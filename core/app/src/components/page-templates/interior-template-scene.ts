import * as THREE from "three";
import { interiorBounds, interiorFurniture, interiorRooms, type InteriorFurniture } from "./interior-template-model";

export type InteriorView = "iso" | "top" | "walk";

export function createInteriorScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f5f4ef");
  scene.fog = new THREE.Fog("#f5f4ef", 26, 48);
  const home = new THREE.Group();
  home.position.set(-interiorBounds.centerX, 0, -interiorBounds.centerZ);
  scene.add(home);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(17.2, 0.22, 10.7),
    new THREE.MeshStandardMaterial({ color: "#b9bbb8", roughness: 0.92 })
  );
  base.position.set(interiorBounds.centerX, -0.13, interiorBounds.centerZ);
  base.receiveShadow = true;
  home.add(base);

  for (const room of interiorRooms) {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(room.width - 0.08, 0.08, room.depth - 0.08),
      new THREE.MeshStandardMaterial({ color: room.floor, roughness: 0.82 })
    );
    floor.position.set(room.x, 0, room.z);
    floor.receiveShadow = true;
    home.add(floor);
    addRoomWalls(home, room.x, room.z, room.width, room.depth);
  }
  for (const item of interiorFurniture) home.add(createFurniture(item));

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa7aaa4, 2.15);
  const sun = new THREE.DirectionalLight(0xfff4de, 3.7);
  sun.position.set(-8, 18, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
  sun.shadow.camera.right = sun.shadow.camera.top = 18;
  scene.add(hemisphere, sun);
  return scene;
}

export function cameraPose(view: InteriorView, roomId: string) {
  const room = interiorRooms.find((entry) => entry.id === roomId);
  const target = new THREE.Vector3(
    room ? room.x - interiorBounds.centerX : 0,
    room ? 0.65 : 0.35,
    room ? room.z - interiorBounds.centerZ : 0
  );
  const span = room ? Math.max(room.width, room.depth) : interiorBounds.span;
  if (view === "top") return { target, position: target.clone().add(new THREE.Vector3(0.01, span * 1.3, 0.01)) };
  if (view === "walk") return { target: target.clone().setY(0.95), position: target.clone().add(new THREE.Vector3(0, 1.55, Math.max(2.5, span * 0.62))) };
  return { target, position: target.clone().add(new THREE.Vector3(span * 0.8, span * 0.72, span * 0.8)) };
}

export function disposeInteriorScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function addRoomWalls(home: THREE.Group, x: number, z: number, width: number, depth: number) {
  const material = new THREE.MeshStandardMaterial({ color: "#f3f1eb", roughness: 0.94 });
  const specs: Array<[number, number, number, number]> = [
    [x, z - depth / 2, width, 0.13],
    [x - width / 2, z, 0.13, depth]
  ];
  for (const [wallX, wallZ, wallWidth, wallDepth] of specs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, 2.25, wallDepth), material.clone());
    wall.position.set(wallX, 1.12, wallZ);
    wall.castShadow = wall.receiveShadow = true;
    home.add(wall);
  }
}

function createFurniture(item: InteriorFurniture) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.75 });
  if (item.kind === "plant") {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(item.width * 0.28, item.width * 0.36, item.height * 0.35, 18), new THREE.MeshStandardMaterial({ color: "#9c7655", roughness: 0.9 }));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(item.width * 0.58, 16, 12), material);
    pot.position.y = item.height * 0.18;
    crown.position.y = item.height * 0.72;
    group.add(pot, crown);
  } else {
    const baseHeight = ["sofa", "bed"].includes(item.kind) ? item.height * 0.5 : item.height;
    const base = new THREE.Mesh(new THREE.BoxGeometry(item.width, baseHeight, item.depth), material);
    base.position.y = baseHeight / 2;
    base.castShadow = base.receiveShadow = true;
    group.add(base);
    if (item.kind === "sofa") addBack(group, item, material, item.depth * 0.4);
    if (item.kind === "chair") addBack(group, item, material, item.depth * 0.36);
    if (item.kind === "bed") {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(item.width * 0.72, 0.12, item.depth * 0.23), new THREE.MeshStandardMaterial({ color: "#ded8cc", roughness: 0.95 }));
      pillow.position.set(0, baseHeight + 0.08, -item.depth * 0.28);
      group.add(pillow);
    }
  }
  group.position.set(item.x - interiorBounds.centerX, 0.08, item.z - interiorBounds.centerZ);
  group.rotation.y = item.rotation || 0;
  return group;
}

function addBack(group: THREE.Group, item: InteriorFurniture, material: THREE.Material, z: number) {
  const back = new THREE.Mesh(new THREE.BoxGeometry(item.width, item.height * 0.55, item.depth * 0.16), material.clone());
  back.position.set(0, item.height * 0.72, z);
  back.castShadow = true;
  group.add(back);
}
