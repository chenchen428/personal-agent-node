import * as THREE from "three";
import { interiorPalette, type InteriorObject, type Point3 } from "./interior-template-model";
import { addOutline, createBox } from "./interior-template-three";

const colors = interiorPalette;

export function createInteriorFurniture(item: InteriorObject) {
  const group = new THREE.Group();
  const [width, height, depth] = item.size;
  const box = (size: Point3, color: string, position: Point3) => group.add(createBox(size, color, position));

  if (item.kind === "rug") {
    box([width, 0.07, depth], colors.stone, [0, 0.035, 0]);
    box([width * 0.82, 0.012, depth * 0.72], colors.wall, [0, 0.076, 0]);
  } else if (item.kind === "bed") {
    box([width, 0.28, depth], colors.floor, [0, 0.18, 0]);
    box([width * 0.94, height * 0.58, depth * 0.88], colors.textile, [0, 0.48, 0.05]);
    box([width * 1.02, 0.95, 0.16], colors.stone, [0, 0.9, -depth * 0.46]);
    box([width * 0.38, 0.13, depth * 0.2], colors.wall, [-width * 0.23, 0.78, -depth * 0.25]);
    box([width * 0.38, 0.13, depth * 0.2], colors.wall, [width * 0.23, 0.78, -depth * 0.25]);
    box([width * 0.64, 0.08, depth * 0.28], colors.accent, [0, 0.71, depth * 0.2]);
  } else if (item.kind === "sofa") {
    box([width, 0.34, depth], colors.textile, [0, 0.28, 0]);
    box([width, 0.65, 0.25], colors.textile, [0, 0.63, -depth * 0.39]);
    box([0.25, 0.52, depth], colors.textile, [-width * 0.47, 0.52, 0]);
    box([0.25, 0.52, depth], colors.textile, [width * 0.47, 0.52, 0]);
    for (const index of [-1, 0, 1]) box([width * 0.22, 0.3, 0.16], index === 0 ? colors.accent : colors.wall, [index * width * 0.27, 0.69, -depth * 0.23]);
  } else if (item.kind === "table") {
    box([width, 0.12, depth], colors.floor, [0, height - 0.12, 0]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) box([0.1, height - 0.1, 0.1], colors.accent, [x * width * 0.38, height * 0.45, z * depth * 0.35]);
    if (item.id === "dining-table") for (const z of [-1, 0, 1]) for (const x of [-1, 1]) {
      const chair = new THREE.Group();
      chair.position.set(x * width * 0.68, 0, z * depth * 0.72);
      chair.add(createBox([0.45, 0.42, 0.45], colors.textile, [0, 0.28, 0]));
      chair.add(createBox([0.45, 0.48, 0.12], colors.textile, [0, 0.62, 0.16 * x]));
      group.add(chair);
    }
  } else if (item.kind === "chair") {
    box([width, 0.3, depth], colors.accent, [0, 0.28, 0]);
    box([width, 0.6, 0.18], colors.accent, [0, 0.65, -depth * 0.4]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) box([0.08, 0.3, 0.08], colors.floor, [x * width * 0.35, 0.15, z * depth * 0.35]);
  } else if (item.kind === "lamp") {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, height * 0.85, 14), new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.65 }));
    stem.position.y = height * 0.45;
    stem.castShadow = true;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.45, width * 0.25, height * 0.22, 18), new THREE.MeshStandardMaterial({ color: colors.wall, roughness: 0.9 }));
    shade.position.y = height * 0.88;
    shade.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.34, width * 0.4, 0.1, 18), new THREE.MeshStandardMaterial({ color: colors.accent }));
    base.position.y = 0.05;
    group.add(stem, shade, base);
  } else if (item.kind === "plant") {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 12), new THREE.MeshStandardMaterial({ color: colors.stone, roughness: 0.9 }));
    pot.position.y = 0.28;
    addOutline(pot);
    group.add(pot);
    for (let index = 0; index < 7; index += 1) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: index % 2 ? colors.accent : "#5f7664", roughness: 0.85 }));
      leaf.position.set(Math.sin(index * 2.1) * 0.25, 0.78 + (index % 3) * 0.13, Math.cos(index * 2.1) * 0.25);
      leaf.rotation.set(0.3, index, 0.5);
      leaf.castShadow = true;
      group.add(leaf);
    }
  } else if (item.kind === "sanitary") {
    box([width, 0.42, depth * 0.64], colors.wall, [0, 0.22, 0.14]);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.42, width * 0.48, 0.28, 18), new THREE.MeshStandardMaterial({ color: colors.wall, roughness: 0.75 }));
    bowl.position.set(0, 0.48, -depth * 0.22);
    bowl.castShadow = true;
    group.add(bowl);
  } else {
    box([width, height, depth], item.kind === "media" ? colors.accent : colors.stone, [0, height / 2, 0]);
    box([0.025, height * 0.72, depth * 0.86], colors.wall, [width * 0.51, height * 0.52, 0]);
  }

  group.position.set(...item.position);
  group.rotation.y = item.rotation;
  return group;
}
