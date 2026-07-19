export type InteriorRoom = {
  id: string;
  name: string;
  note: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  floor: string;
};

export type InteriorFurniture = {
  id: string;
  roomId: string;
  kind: "sofa" | "table" | "chair" | "bed" | "cabinet" | "plant" | "island";
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation?: number;
  color: string;
};

export const interiorRooms: InteriorRoom[] = [
  { id: "living", name: "客厅", note: "核心空间", x: 3.2, z: 6.2, width: 6.2, depth: 4.3, floor: "#caa979" },
  { id: "dining", name: "餐厅", note: "六人餐区", x: 8.6, z: 6.2, width: 4.4, depth: 4.3, floor: "#d3b484" },
  { id: "kitchen", name: "厨房", note: "L 型操作台", x: 12.5, z: 6.2, width: 3.3, depth: 4.3, floor: "#b8b5ac" },
  { id: "master", name: "主卧套房", note: "主卧大床", x: 2.6, z: 2.0, width: 5.0, depth: 3.7, floor: "#d9c39e" },
  { id: "second", name: "次卧", note: "双人床", x: 6.8, z: 2.0, width: 3.4, depth: 3.7, floor: "#d8c19b" },
  { id: "study", name: "书房", note: "独立书桌", x: 10.0, z: 2.0, width: 2.8, depth: 3.7, floor: "#cbb58f" },
  { id: "north", name: "北卧室", note: "双人床", x: 13.4, z: 2.0, width: 3.6, depth: 3.7, floor: "#d7c09a" },
  { id: "balcony", name: "南向阳台", note: "休闲绿植", x: 7.3, z: 9.1, width: 7.8, depth: 1.2, floor: "#c3a16f" }
];

export const interiorFurniture: InteriorFurniture[] = [
  { id: "living-sofa", roomId: "living", kind: "sofa", x: 3.1, z: 6.5, width: 3.2, depth: 1.05, height: 0.75, color: "#f0ede4" },
  { id: "living-table", roomId: "living", kind: "table", x: 3.2, z: 5.0, width: 1.5, depth: 0.75, height: 0.38, color: "#987552" },
  { id: "living-chair", roomId: "living", kind: "chair", x: 5.1, z: 5.6, width: 0.75, depth: 0.8, height: 0.86, rotation: -0.35, color: "#315f4a" },
  { id: "living-media", roomId: "living", kind: "cabinet", x: 0.65, z: 6.2, width: 0.45, depth: 2.7, height: 0.55, color: "#b18b5d" },
  { id: "dining-table", roomId: "dining", kind: "table", x: 8.5, z: 6.2, width: 2.3, depth: 1.0, height: 0.76, color: "#9b744e" },
  { id: "dining-chair-a", roomId: "dining", kind: "chair", x: 7.0, z: 6.2, width: 0.48, depth: 0.52, height: 0.84, color: "#315f4a" },
  { id: "dining-chair-b", roomId: "dining", kind: "chair", x: 10.0, z: 6.2, width: 0.48, depth: 0.52, height: 0.84, color: "#315f4a" },
  { id: "kitchen-island", roomId: "kitchen", kind: "island", x: 12.4, z: 6.2, width: 2.0, depth: 0.9, height: 0.92, color: "#8f8e86" },
  { id: "master-bed", roomId: "master", kind: "bed", x: 2.5, z: 2.0, width: 2.1, depth: 2.2, height: 0.58, color: "#f3efe5" },
  { id: "second-bed", roomId: "second", kind: "bed", x: 6.8, z: 2.0, width: 1.55, depth: 2.05, height: 0.55, color: "#f3efe5" },
  { id: "study-desk", roomId: "study", kind: "table", x: 9.9, z: 1.4, width: 1.55, depth: 0.65, height: 0.74, color: "#9b744e" },
  { id: "north-bed", roomId: "north", kind: "bed", x: 13.4, z: 2.0, width: 1.8, depth: 2.05, height: 0.55, color: "#f3efe5" },
  { id: "balcony-plant-a", roomId: "balcony", kind: "plant", x: 5.0, z: 9.0, width: 0.55, depth: 0.55, height: 1.05, color: "#47704f" },
  { id: "balcony-plant-b", roomId: "balcony", kind: "plant", x: 9.4, z: 9.0, width: 0.65, depth: 0.65, height: 1.2, color: "#3f6948" }
];

export const interiorBounds = { centerX: 8, centerZ: 4.9, span: 16 };
