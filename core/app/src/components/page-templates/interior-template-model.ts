export type Point3 = [number, number, number];

export type InteriorRoom = {
  id: string;
  center: Point3;
  size: [number, number];
  tiled?: boolean;
};

export type InteriorWall = {
  id: string;
  position: Point3;
  size: Point3;
};

export type InteriorObjectKind = "bed" | "cabinet" | "chair" | "lamp" | "media" | "plant" | "rug" | "sanitary" | "sofa" | "table";

export type InteriorObject = {
  id: string;
  kind: InteriorObjectKind;
  position: Point3;
  rotation: number;
  size: Point3;
};

export type InteriorOpening = {
  id: string;
  position: Point3;
  rotation: number;
  width: number;
  kind: "entry" | "door" | "window";
};

export type InteriorLabel = {
  label: string;
  position: Point3;
  tone?: "dark";
};

export const interiorPalette = {
  background: "#e7e9e7",
  floor: "#beb7ac",
  floorAlt: "#969a98",
  wall: "#f4f3ee",
  textile: "#b8b2a8",
  accent: "#4b504d",
  stone: "#7f8581",
};

export const interiorRooms: InteriorRoom[] = [
  { id: "kitchen", center: [-4.65, 0, -5.35], size: [3.1, 2.5], tiled: true },
  { id: "utility-west", center: [-0.8, 0, -5.95], size: [2.8, 1.2], tiled: true },
  { id: "utility-east", center: [3.95, 0, -5.95], size: [3, 1.2], tiled: true },
  { id: "dining", center: [-2.75, 0, -2.85], size: [3, 3.5] },
  { id: "living-extension", center: [-0.8, 0, -3.85], size: [2.8, 3] },
  { id: "study", center: [3.95, 0, -3.85], size: [3, 3] },
  { id: "foyer", center: [-4.7, 0, -0.55], size: [2.9, 2.2] },
  { id: "public-bath", center: [5.15, 0, -0.95], size: [2.1, 2.1], tiled: true },
  { id: "master-bath", center: [5.15, 0, 1.05], size: [2.1, 1.7], tiled: true },
  { id: "living", center: [-0.15, 0, 2.45], size: [7.5, 4.7] },
  { id: "bed-left", center: [-4.65, 0, 3.95], size: [3.1, 3.7] },
  { id: "master", center: [4.35, 0, 4.15], size: [3.7, 3.7] },
  { id: "balcony", center: [-0.1, 0, 5.95], size: [5.7, 1.7], tiled: true },
  { id: "lift", center: [-7.65, 0, -1], size: [2, 3.4], tiled: true },
];

const wallSpecs: Array<[number, number, number, number, number]> = [
  [-4.65, -6.6, 3.1, 2.4, 0.22], [3.95, -6.6, 3, 2.4, 0.22],
  [-6.2, -4.7, 0.22, 2.4, 3.8], [6.2, -0.1, 0.22, 2.4, 13],
  [-4.65, 5.8, 3.1, 2.4, 0.22], [4.35, 6, 3.7, 2.4, 0.22],
  [-6.2, 3.05, 0.22, 2.4, 5.5], [2.5, 4.15, 0.22, 2.4, 3.7],
  [-4.65, -4.1, 3.1, 2.4, 0.22], [-3.1, -5.35, 0.22, 2.4, 2.5],
  [2.45, -3.85, 0.22, 2.4, 3], [5.45, -3.85, 0.22, 2.4, 3], [3.95, -2.35, 3, 2.4, 0.22],
  [4.1, 0.05, 0.22, 2.4, 4.2], [5.15, -2, 2.1, 2.4, 0.22], [5.15, 0.1, 2.1, 2.4, 0.22], [5.15, 1.9, 2.1, 2.4, 0.22],
  [-3.1, 3.95, 0.22, 2.4, 3.7], [-4.65, 2.1, 3.1, 2.4, 0.22], [4.35, 2.3, 3.7, 2.4, 0.22],
  [-6.2, -0.55, 2.9, 2.4, 0.22], [-3.25, -0.55, 0.22, 2.4, 2.2],
  [-7.65, -2.7, 2, 2.4, 0.22], [-7.65, 0.7, 2, 2.4, 0.22], [-8.65, -1, 0.22, 2.4, 3.4],
];

export const interiorWalls: InteriorWall[] = wallSpecs.map(([x, z, width, height, depth], index) => ({
  id: `wall-${index + 1}`,
  position: [x, height / 2, z],
  size: [width, height, depth],
}));

export const interiorOpenings: InteriorOpening[] = [
  { id: "entry", kind: "entry", position: [-6.08, 1.05, -0.55], rotation: Math.PI / 2, width: 1.05 },
  { id: "kitchen", kind: "door", position: [-4.65, 1.05, -4.08], rotation: 0, width: 1.05 },
  { id: "bed-left", kind: "door", position: [-3.08, 1.05, 2.85], rotation: Math.PI / 2, width: 0.9 },
  { id: "study", kind: "door", position: [2.48, 1.05, -2.85], rotation: Math.PI / 2, width: 0.9 },
  { id: "public-bath", kind: "door", position: [4.12, 1.05, -1], rotation: Math.PI / 2, width: 0.82 },
  { id: "master-bath", kind: "door", position: [4.12, 1.05, 1.05], rotation: Math.PI / 2, width: 0.82 },
  { id: "master", kind: "door", position: [3.2, 1.05, 2.32], rotation: 0, width: 0.95 },
  { id: "balcony", kind: "window", position: [-0.1, 1.15, 5.1], rotation: 0, width: 4.7 },
  { id: "utility-west", kind: "window", position: [-0.8, 1.15, -5.32], rotation: 0, width: 2.4 },
  { id: "utility-east", kind: "window", position: [3.95, 1.15, -5.32], rotation: 0, width: 2.55 },
  { id: "kitchen-window", kind: "window", position: [-4.65, 1.15, -6.48], rotation: 0, width: 2.15 },
  { id: "study-window", kind: "window", position: [3.95, 1.15, -6.48], rotation: 0, width: 2.4 },
  { id: "bed-bay-window", kind: "window", position: [-4.65, 1.15, 5.72], rotation: 0, width: 2.25 },
  { id: "master-bay-window", kind: "window", position: [4.35, 1.15, 5.92], rotation: 0, width: 2.8 },
];

export const interiorObjects: InteriorObject[] = [
  { id: "kitchen-run", kind: "cabinet", position: [-4.65, 0, -6.15], size: [2.7, 0.92, 0.62], rotation: 0 },
  { id: "kitchen-side-run", kind: "cabinet", position: [-5.75, 0, -5.15], size: [0.62, 1.8, 1.2], rotation: 0 },
  { id: "utility-washer", kind: "cabinet", position: [-1.65, 0, -5.95], size: [0.7, 1.9, 0.75], rotation: 0 },
  { id: "utility-storage", kind: "cabinet", position: [4.85, 0, -5.95], size: [0.72, 1.9, 0.75], rotation: 0 },
  { id: "dining-table", kind: "table", position: [-2.75, 0, -2.75], size: [2, 0.76, 0.92], rotation: 0 },
  { id: "dining-sideboard", kind: "cabinet", position: [-4.05, 0, -3.3], size: [0.48, 1.05, 2.1], rotation: 0 },
  { id: "extension-rug", kind: "rug", position: [-0.75, 0, -3.8], size: [2.2, 0.06, 2.25], rotation: 0 },
  { id: "extension-chair", kind: "chair", position: [-0.95, 0, -3.75], size: [0.82, 0.9, 0.82], rotation: -0.45 },
  { id: "extension-table", kind: "table", position: [0.1, 0, -3.45], size: [0.58, 0.5, 0.58], rotation: 0 },
  { id: "study-desk", kind: "table", position: [3.95, 0, -4.65], size: [1.65, 0.76, 0.68], rotation: 0 },
  { id: "study-chair", kind: "chair", position: [3.95, 0, -3.85], size: [0.58, 0.84, 0.58], rotation: Math.PI },
  { id: "study-sofa-bed", kind: "sofa", position: [3.95, 0, -2.85], size: [2.1, 0.82, 0.86], rotation: Math.PI },
  { id: "foyer-cabinet", kind: "cabinet", position: [-5.65, 0, -0.55], size: [0.5, 2.1, 1.7], rotation: 0 },
  { id: "public-toilet", kind: "sanitary", position: [5.2, 0, -1.05], size: [0.68, 0.75, 0.9], rotation: 0 },
  { id: "master-toilet", kind: "sanitary", position: [5.2, 0, 1.05], size: [0.68, 0.75, 0.9], rotation: Math.PI },
  { id: "living-rug", kind: "rug", position: [-0.25, 0, 3.1], size: [4.4, 0.06, 2.7], rotation: 0 },
  { id: "living-sofa", kind: "sofa", position: [-1.55, 0, 2.25], size: [3, 0.9, 1.05], rotation: 0 },
  { id: "coffee-table", kind: "table", position: [-0.45, 0, 3.45], size: [1.6, 0.48, 0.72], rotation: 0 },
  { id: "accent-chair", kind: "chair", position: [1.4, 0, 3.45], size: [0.82, 0.9, 0.82], rotation: -0.4 },
  { id: "living-media", kind: "media", position: [2.95, 0, 2.75], size: [0.48, 1.35, 2.9], rotation: 0 },
  { id: "living-lamp", kind: "lamp", position: [-2.8, 0, 3.65], size: [0.4, 1.7, 0.4], rotation: 0 },
  { id: "living-plant", kind: "plant", position: [2.1, 0, 4.35], size: [0.8, 1.3, 0.8], rotation: 0 },
  { id: "bed-left", kind: "bed", position: [-4.65, 0, 4.15], size: [1.9, 0.75, 2], rotation: 0 },
  { id: "bed-left-side", kind: "cabinet", position: [-5.75, 0, 4.15], size: [0.5, 0.52, 0.5], rotation: 0 },
  { id: "master-rug", kind: "rug", position: [4.35, 0, 4.35], size: [3.15, 0.05, 3], rotation: 0 },
  { id: "master-bed", kind: "bed", position: [4.35, 0, 4.2], size: [2.1, 0.75, 2.05], rotation: 0 },
  { id: "master-side-left", kind: "cabinet", position: [3.15, 0, 4.2], size: [0.52, 0.55, 0.52], rotation: 0 },
  { id: "master-side-right", kind: "cabinet", position: [5.55, 0, 4.2], size: [0.52, 0.55, 0.52], rotation: 0 },
  { id: "master-wardrobe", kind: "cabinet", position: [5.75, 0, 2.75], size: [0.5, 2.15, 1.4], rotation: 0 },
  { id: "balcony-seat", kind: "chair", position: [-0.2, 0, 5.95], size: [0.82, 0.86, 0.82], rotation: 0.25 },
  { id: "balcony-table", kind: "table", position: [0.85, 0, 5.95], size: [0.64, 0.52, 0.64], rotation: 0 },
  { id: "balcony-plant", kind: "plant", position: [-2.25, 0, 5.95], size: [0.75, 1.05, 0.75], rotation: 0 },
];

export const interiorLabels: InteriorLabel[] = [
  { label: "入户门", position: [-6.15, 2.75, -0.55], tone: "dark" },
  { label: "电梯厅", position: [-7.65, 1.6, -1] },
  { label: "玄关收纳", position: [-4.8, 2.15, -0.55] },
  { label: "厨房 · L 型橱柜", position: [-4.65, 2.05, -5.35] },
  { label: "六人餐桌", position: [-2.75, 1.7, -2.75], tone: "dark" },
  { label: "原卧室并入公共区", position: [-0.8, 1.55, -3.85], tone: "dark" },
  { label: "书房兼客卧", position: [3.95, 1.65, -3.85] },
  { label: "大客厅 · 连续公共区", position: [-0.2, 1.7, 2.2], tone: "dark" },
  { label: "公卫 · 干湿分区", position: [5.15, 1.65, -0.95] },
  { label: "主卫", position: [5.15, 1.65, 1.05] },
  { label: "保留次卧", position: [-4.65, 1.65, 4.15] },
  { label: "主卧套房", position: [4.35, 1.65, 4.2], tone: "dark" },
  { label: "生活阳台一", position: [-0.8, 1.45, -5.95] },
  { label: "生活阳台二", position: [3.95, 1.45, -5.95] },
  { label: "南向阳台", position: [-0.1, 1.35, 5.95], tone: "dark" },
  { label: "次卧凸窗", position: [-4.65, 1.3, 6.05] },
  { label: "主卧凸窗", position: [4.35, 1.3, 6.25] },
  { label: "北", position: [0, 3.2, -6.8] },
  { label: "南", position: [0, 2.8, 6.9] },
];

export const interiorBounds = { center: [-0.8, 0.4, 0] as Point3 };
