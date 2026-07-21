import * as THREE from "three";
import { interiorBounds, interiorFurniture, interiorRooms, type InteriorFurniture } from "./interior-template-model";

export type InteriorView = "iso" | "top" | "walk";

export function createInteriorScene(level: "level-1" | "level-2" = "level-1") {
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
  addOutline(base);
  home.add(base);

  if (level === "level-1") for (const room of interiorRooms) {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(room.width - 0.08, 0.08, room.depth - 0.08),
      new THREE.MeshStandardMaterial({ color: room.floor, roughness: 0.82 })
    );
    floor.position.set(room.x, 0, room.z);
    floor.receiveShadow = true;
    home.add(floor);
    addRoomWalls(home, room.id, room.x, room.z, room.width, room.depth);
  }
  if (level === "level-1") {
    for (const item of interiorFurniture) home.add(createFurniture(item));
    addOpenings(home);
    addBalcony(home);
  } else addLoft(home);

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

function addLoft(home: THREE.Group) {
  const levelPlate = new THREE.Mesh(new THREE.BoxGeometry(8.6, .12, 6.8), new THREE.MeshStandardMaterial({ color: "#dadbd7", roughness: 1 }));
  levelPlate.position.set(5.6, 2.86, 5.9); addOutline(levelPlate); home.add(levelPlate);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, .22, 3.1), new THREE.MeshStandardMaterial({ color: "#b9a17e", roughness: .86 }));
  slab.position.set(3.2, 3.05, 5.85); addOutline(slab); home.add(slab);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: "#f2f0ea", roughness: .94 });
  for (const [x, z, width, depth] of [[1.45, 5.85, .13, 3.1], [3.2, 4.35, 3.6, .13]] as Array<[number, number, number, number]>) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, 2.35, depth), wallMaterial.clone());
    wall.position.set(x, 4.22, z); addOutline(wall); home.add(wall);
  }
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.65, .72, .7), new THREE.MeshStandardMaterial({ color: "#a9845b", roughness: .78 }));
  desk.position.set(3.2, 3.5, 5.45); addOutline(desk); home.add(desk);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.45, 1.05, .08), new THREE.MeshStandardMaterial({ color: "#353c38", roughness: .7 }));
  rail.position.set(3.2, 3.58, 7.34); addOutline(rail); home.add(rail);
  const voidFrame = new THREE.Mesh(new THREE.BoxGeometry(4.45, .08, 5.8), new THREE.MeshBasicMaterial({ color: "#59605b", wireframe: true }));
  voidFrame.position.set(7.1, 3.02, 5.85); home.add(voidFrame);
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
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function addRoomWalls(home: THREE.Group, roomId: string, x: number, z: number, width: number, depth: number) {
  const material = new THREE.MeshStandardMaterial({ color: "#f3f1eb", roughness: 0.94 });
  const specs: Array<[number, number, number, number]> = roomId === "living-extension" ? [] : [
    [x, z - depth / 2, width, 0.13],
    [x - width / 2, z, 0.13, depth]
  ];
  for (const [wallX, wallZ, wallWidth, wallDepth] of specs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, 2.25, wallDepth), material.clone());
    wall.position.set(wallX, 1.12, wallZ);
    wall.castShadow = wall.receiveShadow = true;
    addOutline(wall);
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
    addOutline(base);
    group.add(base);
    if (item.kind === "sofa") addBack(group, item, material, item.depth * 0.4);
    if (item.kind === "chair") addBack(group, item, material, item.depth * 0.36);
    if (item.kind === "bed") {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(item.width * 0.72, 0.12, item.depth * 0.23), new THREE.MeshStandardMaterial({ color: "#ded8cc", roughness: 0.95 }));
      pillow.position.set(0, baseHeight + 0.08, -item.depth * 0.28);
      group.add(pillow);
    }
  }
  group.position.set(item.x, 0.08, item.z);
  group.rotation.y = item.rotation || 0;
  return group;
}

function addBack(group: THREE.Group, item: InteriorFurniture, material: THREE.Material, z: number) {
  const back = new THREE.Mesh(new THREE.BoxGeometry(item.width, item.height * 0.55, item.depth * 0.16), material.clone());
  back.position.set(0, item.height * 0.72, z);
  back.castShadow = true;
  addOutline(back);
  group.add(back);
}

function addOpenings(home: THREE.Group) {
  const doorMaterial = new THREE.MeshStandardMaterial({ color: "#8d6a48", roughness: 0.82 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: "#343b37", roughness: 0.68 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: "#cddbd5", transparent: true, opacity: 0.38, roughness: 0.18 });
  const doors: Array<[number, number, number]> = [[0.35, 4.9, Math.PI / 2], [5.2, 3.9, 0], [11.4, 3.9, 0], [4.9, 8.35, 0]];
  for (const [x, z, rotation] of doors) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.2, 0.16), frameMaterial.clone());
    frame.position.set(x, 1.1, z);
    frame.rotation.y = rotation;
    addOutline(frame);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.98, 0.08), doorMaterial.clone());
    leaf.position.set(0, -0.08, 0.1);
    addOutline(leaf);
    frame.add(leaf);
    home.add(frame);
  }
  for (const x of [4.9, 6.5, 8.1, 9.7]) {
    const window = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.55, 0.08), glassMaterial.clone());
    window.position.set(x, 1.15, 9.69);
    addOutline(window);
    home.add(window);
  }
}

function addBalcony(home: THREE.Group) {
  const material = new THREE.MeshStandardMaterial({ color: "#303834", roughness: 0.7 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.08, 0.09), material);
  top.position.set(7.3, 1.05, 9.65);
  addOutline(top);
  home.add(top);
  for (const x of [3.55, 5.45, 7.35, 9.25, 11.1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.08), material.clone());
    post.position.set(x, .52, 9.65);
    addOutline(post);
    home.add(post);
  }
}

function addOutline(mesh: THREE.Mesh) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 24);
  mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: "#59605b", transparent: true, opacity: .72 })));
}
