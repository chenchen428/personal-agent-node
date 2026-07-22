import * as THREE from "three";
import type { Point3 } from "./interior-template-model";

export function createBox(size: Point3, color: THREE.ColorRepresentation, position: Point3 = [0, 0, 0], roughness = 0.78) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness })
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh);
  return mesh;
}

export function addOutline(mesh: THREE.Mesh, color = "#555957") {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 28);
  mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 })));
}
