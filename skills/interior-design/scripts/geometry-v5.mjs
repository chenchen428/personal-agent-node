import crypto from "node:crypto";
import { auditPortalTopology } from "./portal-topology-v5.mjs";

const ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/; // V5 stable artifact IDs

export function normalizeGeometry(input, { projectId, revision }) {
  const geometry = structuredClone(input || {});
  geometry.schemaVersion = 5;
  geometry.projectId = projectId;
  geometry.revision = revision;
  geometry.units = "mm";
  geometry.coordinateSystem ||= { plan: "x-right-y-down", vertical: "z-up" };
  geometry.basis ||= { grade: "estimated", sourceEvidenceIds: [], confidence: 0.5 };
  for (const key of ["levels", "rooms", "walls", "openings", "elements", "points", "clearances", "cameras", "dimensions", "ceilingZones", "circuits", "plumbingRuns", "cabinetModules", "portals", "panoramaNodes"]) {
    geometry[key] = Array.isArray(geometry[key]) ? geometry[key] : [];
  }
  return geometry;
}

export function auditInteriorWorkspace(project, geometry) {
  const issues = [];
  const ids = new Map();
  const allCollections = [
    ["level", geometry.levels], ["room", geometry.rooms], ["wall", geometry.walls],
    ["opening", geometry.openings], ["element", geometry.elements], ["point", geometry.points],
    ["portal", geometry.portals], ["panorama-node", geometry.panoramaNodes],
  ];

  if (geometry.units !== "mm") issue(issues, "error", "GEO-UNIT", "几何单位必须统一为毫米。", ["geometry.json"]);
  if (!geometry.levels.length) issue(issues, "error", "GEO-LEVEL", "至少需要一个楼层。", ["geometry.json"]);
  for (const [kind, entries] of allCollections) {
    for (const entry of entries) {
      if (!ID_PATTERN.test(entry?.id || "")) issue(issues, "error", "GEO-ID", `${kind} 缺少稳定且合法的 ID。`, [entry?.id || kind]);
      if (ids.has(entry?.id)) issue(issues, "error", "GEO-ID-DUPLICATE", `ID 重复：${entry.id}`, [entry.id]);
      ids.set(entry?.id, kind);
    }
  }

  const levels = new Set(geometry.levels.map((entry) => entry.id));
  const rooms = new Set(geometry.rooms.map((entry) => entry.id));
  const walls = new Map(geometry.walls.map((entry) => [entry.id, entry]));
  for (const room of geometry.rooms) {
    if (!levels.has(room.levelId)) issue(issues, "error", "GEO-ROOM-LEVEL", `空间 ${room.id} 引用了不存在的楼层。`, [room.id]);
    if (!validPolygon(room.polygon)) issue(issues, "error", "GEO-ROOM-POLYGON", `空间 ${room.id} 的边界无效。`, [room.id]);
    const area = polygonArea(room.polygon || []) / 1_000_000;
    if (area < 1) issue(issues, "warning", "GEO-ROOM-AREA", `空间 ${room.id} 的推导面积不足 1㎡。`, [room.id]);
    if (Number.isFinite(room.declaredAreaSqM) && Math.abs(area - room.declaredAreaSqM) > Math.max(1, room.declaredAreaSqM * 0.08)) {
      issue(issues, "hold", "GEO-AREA-MISMATCH", `${room.name || room.id} 的声明面积与几何面积偏差超过 8%，需复尺。`, [room.id]);
    }
  }
  for (const wall of geometry.walls) {
    if (!levels.has(wall.levelId)) issue(issues, "error", "GEO-WALL-LEVEL", `墙体 ${wall.id} 引用了不存在的楼层。`, [wall.id]);
    if (!validPoint(wall.start) || !validPoint(wall.end) || wallLength(wall) < 100) issue(issues, "error", "GEO-WALL-LENGTH", `墙体 ${wall.id} 的端点或长度无效。`, [wall.id]);
    if (!positive(wall.thickness) || !positive(wall.height)) issue(issues, "error", "GEO-WALL-SIZE", `墙体 ${wall.id} 的厚度或高度无效。`, [wall.id]);
  }
  for (const opening of geometry.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall) {
      issue(issues, "error", "GEO-OPENING-WALL", `洞口 ${opening.id} 引用了不存在的墙体。`, [opening.id]);
      continue;
    }
    const length = wallLength(wall);
    if (!positive(opening.width) || !positive(opening.height) || opening.offset < 0 || opening.offset + opening.width > length + 1) {
      issue(issues, "error", "GEO-OPENING-RANGE", `洞口 ${opening.id} 超出墙体范围或尺寸无效。`, [opening.id, opening.wallId]);
    }
    if ((opening.sill || 0) + opening.height > wall.height + 1) issue(issues, "error", "GEO-OPENING-HEIGHT", `洞口 ${opening.id} 超出墙高。`, [opening.id]);
  }
  for (const element of geometry.elements) {
    if (element.roomId && !rooms.has(element.roomId)) issue(issues, "error", "GEO-ELEMENT-ROOM", `构件 ${element.id} 引用了不存在的空间。`, [element.id]);
    if (!validPoint3(element.position) || !Array.isArray(element.size) || element.size.length !== 3 || !element.size.every(positive)) {
      issue(issues, "error", "GEO-ELEMENT-SIZE", `构件 ${element.id} 的位置或尺寸无效。`, [element.id]);
    }
  }
  for (const point of geometry.points) {
    if (point.roomId && !rooms.has(point.roomId)) issue(issues, "error", "GEO-POINT-ROOM", `点位 ${point.id} 引用了不存在的空间。`, [point.id]);
    if (!validPoint(point.position) || !Number.isFinite(point.mountHeight)) issue(issues, "error", "GEO-POINT-POSITION", `点位 ${point.id} 的位置或安装高度无效。`, [point.id]);
  }

  const panoramaIds = new Set(geometry.panoramaNodes.map((entry) => entry.id));
  const solidElements = geometry.elements.filter((entry) => entry.collisionClass === "solid" && entry.allowOverlap !== true);
  for (const node of geometry.panoramaNodes) {
    const refs = [node.id || "panorama-node"];
    const room = geometry.rooms.find((entry) => entry.id === node.roomId);
    if (!room) issue(issues, "error", "GEO-PANORAMA-ROOM", `全景节点 ${node.id} 引用了不存在的空间。`, refs);
    if (!validPoint3(node.position) || !validPoint3(node.lookAt)) {
      issue(issues, "error", "GEO-PANORAMA-CAMERA", `全景节点 ${node.id} 缺少有效的相机位置或观察目标。`, refs);
      continue;
    }
    if (room && !pointInPolygon(node.position, room.polygon)) {
      issue(issues, "error", "GEO-PANORAMA-OUTSIDE", `全景节点 ${node.id} 的相机不在指定房间内。`, [node.id, room.id]);
    }
    if (node.position[2] < 1200 || node.position[2] > 1800) {
      issue(issues, "warning", "GEO-PANORAMA-HEIGHT", `全景节点 ${node.id} 的相机高度 ${node.position[2]}mm 超出建议的 1200–1800mm。`, refs);
    }
    if (Math.hypot(node.lookAt[0] - node.position[0], node.lookAt[1] - node.position[1], node.lookAt[2] - node.position[2]) < 300) {
      issue(issues, "error", "GEO-PANORAMA-DIRECTION", `全景节点 ${node.id} 的观察目标与相机位置过近，无法确定稳定朝向。`, refs);
    }
    const collision = solidElements.find((entry) => (!node.roomId || entry.roomId === node.roomId) && pointInsideElementFootprint(node.position, entry, 250));
    if (collision) {
      issue(issues, "error", "GEO-PANORAMA-COLLISION", `全景节点 ${node.id} 的相机落在 ${collision.name || collision.id} 内或距离过近。`, [node.id, collision.id]);
    }
    const targets = new Set();
    for (const hotspot of node.hotspots || []) {
      if (!panoramaIds.has(hotspot.target)) issue(issues, "error", "GEO-PANORAMA-HOTSPOT", `全景节点 ${node.id} 指向了不存在的热点目标 ${hotspot.target}。`, [node.id, hotspot.target]);
      if (hotspot.target === node.id) issue(issues, "error", "GEO-PANORAMA-HOTSPOT-SELF", `全景节点 ${node.id} 不能跳转到自身。`, refs);
      if (targets.has(hotspot.target)) issue(issues, "warning", "GEO-PANORAMA-HOTSPOT-DUPLICATE", `全景节点 ${node.id} 存在重复热点 ${hotspot.target}。`, [node.id, hotspot.target]);
      targets.add(hotspot.target);
    }
  }
  issues.push(...auditPortalTopology(geometry));

  const elementIds = new Set(geometry.elements.map((entry) => entry.id));
  const roomIds = new Set(geometry.rooms.map((entry) => entry.id));
  const pointIds = new Set(geometry.points.map((entry) => entry.id));
  const traceableIds = new Set([...elementIds, ...roomIds, ...pointIds]);
  for (const requirement of project.requirements || []) {
    if (requirement.priority === "must" && !["satisfied", "blocked"].includes(requirement.status)) {
      issue(issues, "error", "REQ-MUST", `必选需求 ${requirement.id} 未满足且未明确阻断。`, [requirement.id]);
    }
    for (const designId of requirement.designElementIds || []) {
      if (!traceableIds.has(designId)) issue(issues, "error", "REQ-TRACE", `需求 ${requirement.id} 引用了不存在的设计对象 ${designId}。`, [requirement.id, designId]);
    }
  }

  for (const clearance of geometry.clearances) {
    if (!Number.isFinite(clearance.actualMm) || !Number.isFinite(clearance.requiredMm)) {
      issue(issues, "error", "GEO-CLEARANCE", `净距检查 ${clearance.id || "unknown"} 缺少数值。`, [clearance.id || "clearance"]);
    } else if (clearance.actualMm < clearance.requiredMm) {
      issue(issues, clearance.severity === "hold" ? "hold" : "error", "GEO-CLEARANCE-FAIL", `${clearance.label || clearance.id} 实测/模型净距 ${clearance.actualMm}mm，小于要求 ${clearance.requiredMm}mm。`, clearance.elementIds || []);
    }
  }

  const collidable = geometry.elements.filter((entry) => entry.collisionClass === "solid" && entry.allowOverlap !== true);
  for (let index = 0; index < collidable.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < collidable.length; otherIndex += 1) {
      const left = collidable[index];
      const right = collidable[otherIndex];
      if (left.roomId === right.roomId && overlaps2d(left, right)) {
        issue(issues, "warning", "GEO-COLLISION", `构件 ${left.id} 与 ${right.id} 的平面包围盒重叠，请复核真实造型。`, [left.id, right.id]);
      }
    }
  }

  const uncertainGeometry = [
    ...geometry.walls.filter((entry) => (entry.confidence ?? geometry.basis.confidence ?? 0) < 0.9),
    ...geometry.openings.filter((entry) => (entry.confidence ?? geometry.basis.confidence ?? 0) < 0.9),
  ];
  if (geometry.basis.grade !== "surveyed" || uncertainGeometry.length) {
    issue(issues, "hold", "GEO-SITE-MEASURE", `共有 ${uncertainGeometry.length} 个墙体/洞口尺寸尚未达到现场测量置信度，施工与定制生产必须复尺。`, uncertainGeometry.slice(0, 12).map((entry) => entry.id));
  }
  for (const unknown of project.unknowns || []) {
    if (unknown.status !== "resolved") issue(issues, "hold", "PRO-UNKNOWN", unknown.statement, [unknown.id]);
  }
  for (const verification of project.professionalVerifications || []) {
    if (verification.status !== "verified") issue(issues, "hold", "PRO-VERIFY", verification.statement, [verification.id]);
  }

  const counts = Object.fromEntries(["error", "hold", "warning", "info"].map((level) => [level, issues.filter((entry) => entry.level === level).length]));
  return {
    schemaVersion: 5,
    projectId: project.projectId,
    revision: project.revision,
    status: counts.error ? "blocked" : "concept-ready",
    conceptReady: counts.error === 0,
    constructionReady: counts.error === 0 && counts.hold === 0 && geometry.basis.grade === "surveyed",
    productionReady: false,
    counts,
    metrics: geometryMetrics(geometry),
    issues,
    visualAcceptance: "user",
  };
}

export function geometryMetrics(geometry) {
  return {
    levels: geometry.levels.length,
    rooms: geometry.rooms.length,
    walls: geometry.walls.length,
    openings: geometry.openings.length,
    portals: (geometry.portals ?? []).length,
    elements: geometry.elements.length,
    points: geometry.points.length,
    modeledAreaSqM: round(geometry.rooms.reduce((sum, room) => sum + polygonArea(room.polygon || []), 0) / 1_000_000, 2),
  };
}

export function buildModelPrimitives(project, geometry) {
  const colors = materialColors(project);
  const primitives = [];
  for (const room of geometry.rooms) {
    const bounds = polygonBounds(room.polygon);
    primitives.push({ id: room.id, name: room.name, kind: "floor", material: "floor", color: colors.floor, center: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, -30], size: [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 60], rotationDeg: 0, roomId: room.id });
  }
  for (const wall of geometry.walls) primitives.push(...wallPrimitives(wall, geometry.openings.filter((entry) => entry.wallId === wall.id), colors));
  for (const element of geometry.elements) primitives.push(...elementPrimitives(element, colors));
  for (const point of geometry.points.filter((entry) => entry.type === "light")) {
    primitives.push({ id: `${point.id}-fixture`, name: point.label || "灯具", kind: "light", material: "light", color: colors.light, center: [point.position[0], point.position[1], Math.max(0, point.mountHeight - 55)], size: [130, 130, 55], rotationDeg: 0, roomId: point.roomId || null });
  }
  return primitives;
}

export function renderPlanSvg(project, geometry) {
  const bounds = geometryBounds(geometry);
  const margin = 700;
  const view = [bounds.minX - margin, bounds.minY - margin, bounds.maxX - bounds.minX + margin * 2, bounds.maxY - bounds.minY + margin * 2];
  const roomSvg = geometry.rooms.map((room, index) => {
    const fill = ["#ebe5d8", "#dce6df", "#e8ded8", "#e2e6ea", "#eee8df"][index % 5];
    const center = polygonCentroid(room.polygon);
    return `<g data-room-id="${xml(room.id)}"><polygon points="${room.polygon.map((point) => point.join(",")).join(" ")}" fill="${fill}" stroke="#b5aa98" stroke-width="24"/><text x="${center[0]}" y="${center[1]}" class="room-label">${xml(room.name || room.id)}</text></g>`;
  }).join("\n");
  const wallSvg = geometry.walls.map((wall) => `<line data-wall-id="${xml(wall.id)}" x1="${wall.start[0]}" y1="${wall.start[1]}" x2="${wall.end[0]}" y2="${wall.end[1]}" stroke="#202322" stroke-width="${wall.thickness}" stroke-linecap="square"/>`).join("\n");
  const openingSvg = geometry.openings.map((opening) => {
    const wall = geometry.walls.find((entry) => entry.id === opening.wallId);
    if (!wall) return "";
    const [start, end] = openingSegment(wall, opening);
    const color = opening.type === "window" ? "#4f7f92" : "#b16c45";
    return `<line data-opening-id="${xml(opening.id)}" x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#fff" stroke-width="${wall.thickness + 60}"/><line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-width="34"/>`;
  }).join("\n");
  const elementSvg = geometry.elements.map((entry) => `<g data-element-id="${xml(entry.id)}" transform="translate(${entry.position[0]} ${entry.position[1]}) rotate(${entry.rotationDeg || 0})"><rect x="${-entry.size[0] / 2}" y="${-entry.size[1] / 2}" width="${entry.size[0]}" height="${entry.size[1]}" rx="40" fill="${entry.color || "#a8967d"}" fill-opacity=".72" stroke="#5b5146" stroke-width="22"/><title>${xml(entry.name || entry.type)}</title></g>`).join("\n");
  const pointSvg = geometry.points.map((entry) => `<g data-point-id="${xml(entry.id)}"><circle cx="${entry.position[0]}" cy="${entry.position[1]}" r="90" fill="${pointColor(entry.type)}" stroke="#fff" stroke-width="24"/><text x="${entry.position[0] + 120}" y="${entry.position[1] - 100}" class="point-label">${xml(entry.label || entry.type)}</text></g>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(" ")}" role="img" aria-labelledby="title desc"><title id="title">${xml(project.title)} 平面设计图</title><desc id="desc">由统一 geometry.json 确定性生成的概念设计平面图，单位毫米。</desc><style>.room-label{font:600 180px system-ui;fill:#2c302e;text-anchor:middle;dominant-baseline:middle}.point-label{font:500 115px system-ui;fill:#38413e}.meta{font:500 120px system-ui;fill:#56605c}</style><rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#f7f5f0"/>${roomSvg}${wallSvg}${openingSvg}${elementSvg}${pointSvg}<text x="${view[0] + 120}" y="${view[1] + 220}" class="meta">概念设计 · 单位 mm · 施工前复尺</text></svg>\n`;
}

export function wallLength(wall) { return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]); }
export function polygonArea(points) { return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length] || point; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2); }
export function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex"); }

function wallPrimitives(wall, openings, colors) {
  const length = wallLength(wall);
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
  const spans = openings.map((entry) => ({ start: entry.offset, end: entry.offset + entry.width, opening: entry })).sort((a, b) => a.start - b.start);
  const output = [];
  let cursor = 0;
  let index = 0;
  for (const span of spans) {
    if (span.start > cursor) output.push(localWallBox(wall, cursor, span.start, 0, wall.height, angle, `${wall.id}-segment-${index++}`, colors.wall));
    const sill = span.opening.sill || 0;
    if (sill > 0) output.push(localWallBox(wall, span.start, span.end, 0, sill, angle, `${wall.id}-sill-${index++}`, colors.wall));
    const head = sill + span.opening.height;
    if (head < wall.height) output.push(localWallBox(wall, span.start, span.end, head, wall.height - head, angle, `${wall.id}-head-${index++}`, colors.wall));
    output.push(...openingDetailPrimitives(wall, span, angle, colors));
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < length) output.push(localWallBox(wall, cursor, length, 0, wall.height, angle, `${wall.id}-segment-${index++}`, colors.wall));
  return output.filter((entry) => entry.size[0] > 1 && entry.size[2] > 1);
}

function openingDetailPrimitives(wall, span, angle, colors) {
  const opening = span.opening;
  const sill = opening.sill || 0;
  const frame = Math.min(64, Math.max(42, opening.width * 0.035));
  const output = [];
  if (opening.type === "window") {
    const glassHeight = Math.max(80, opening.height - frame * 2);
    output.push(localWallBox(wall, span.start + frame, span.end - frame, sill + frame, glassHeight, angle, `${opening.id}-glass`, colors.glass, "glass", Math.max(18, wall.thickness * 0.16)));
    output.push(localWallBox(wall, span.start, span.start + frame, sill, opening.height, angle, `${opening.id}-frame-left`, colors.frame, "window-frame", wall.thickness + 42));
    output.push(localWallBox(wall, span.end - frame, span.end, sill, opening.height, angle, `${opening.id}-frame-right`, colors.frame, "window-frame", wall.thickness + 42));
    output.push(localWallBox(wall, span.start + frame, span.end - frame, sill, frame, angle, `${opening.id}-frame-bottom`, colors.frame, "window-frame", wall.thickness + 42));
    output.push(localWallBox(wall, span.start + frame, span.end - frame, sill + opening.height - frame, frame, angle, `${opening.id}-frame-top`, colors.frame, "window-frame", wall.thickness + 42));
    if (opening.width >= 1400) {
      const middle = (span.start + span.end) / 2;
      output.push(localWallBox(wall, middle - frame * 0.34, middle + frame * 0.34, sill + frame, glassHeight, angle, `${opening.id}-mullion`, colors.frame, "window-frame", wall.thickness + 48));
    }
    const sillFrom = Math.max(0, span.start - 45);
    const sillTo = Math.min(wallLength(wall), span.end + 45);
    output.push(localWallBox(wall, sillFrom, sillTo, Math.max(0, sill - 28), 34, angle, `${opening.id}-window-sill`, colors.sill, "window-sill", wall.thickness + 150));
    return output;
  }
  if (opening.type === "door") {
    output.push(localWallBox(wall, span.start, span.start + frame, 0, opening.height, angle, `${opening.id}-frame-left`, colors.frame, "door-frame", wall.thickness + 36));
    output.push(localWallBox(wall, span.end - frame, span.end, 0, opening.height, angle, `${opening.id}-frame-right`, colors.frame, "door-frame", wall.thickness + 36));
    output.push(localWallBox(wall, span.start + frame, span.end - frame, opening.height - frame, frame, angle, `${opening.id}-frame-top`, colors.frame, "door-frame", wall.thickness + 36));
    const leafWidth = Math.max(300, opening.width - frame * 2.4);
    const openAngle = Number(opening.openAngleDeg ?? 32) * Math.PI / 180;
    const hingeDistance = span.start + frame * 1.2;
    const hingeX = wall.start[0] + Math.cos(angle) * hingeDistance;
    const hingeY = wall.start[1] + Math.sin(angle) * hingeDistance;
    const leafAngle = angle + openAngle;
    const leaf = {
      id: `${opening.id}-leaf`, name: opening.name || "门扇", kind: "door", material: "door", color: colors.door,
      center: [hingeX + Math.cos(leafAngle) * leafWidth / 2, hingeY + Math.sin(leafAngle) * leafWidth / 2, 30],
      size: [leafWidth, 42, Math.max(120, opening.height - frame - 45)], rotationDeg: leafAngle * 180 / Math.PI, roomId: null,
    };
    output.push(leaf);
    output.push({ ...leaf, id: `${opening.id}-handle`, name: "门把手", kind: "door-handle", material: "metal", color: "#9d825a", center: [hingeX + Math.cos(leafAngle) * leafWidth * 0.88, hingeY + Math.sin(leafAngle) * leafWidth * 0.88, 980], size: [52, 86, 52], shape: "sphere" });
  }
  return output;
}

function localWallBox(wall, from, to, baseZ, height, angle, id, color, kind = "wall", depth = wall.thickness) {
  const mid = (from + to) / 2;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  return { id, name: wall.name || wall.id, kind, material: kind, color, center: [wall.start[0] + ux * mid, wall.start[1] + uy * mid, baseZ], size: [to - from, depth, height], rotationDeg: angle * 180 / Math.PI, roomId: null };
}

function elementPrimitives(element, colors) {
  const color = element.color || colors[element.materialId] || colors[element.type] || colors.furniture;
  const material = element.materialId || element.type;
  const base = elementBox(element, element.id, element.name || element.type, element.type, material, color, [0, 0, 0], element.size);
  const [width, depth, height] = element.size;
  if (element.type === "bed") {
    return [
      elementBox(element, `${element.id}-base`, element.name, "bed-base", material, darken(color, 0.82), [0, 0, 0], [width, depth, Math.min(300, height * 0.55)]),
      elementBox(element, `${element.id}-mattress`, `${element.name}床垫`, "mattress", "fabric", lighten(color, 1.16), [0, 0, Math.min(300, height * 0.55)], [width * 0.94, depth * 0.94, Math.max(140, height * 0.42)]),
      elementBox(element, `${element.id}-headboard`, `${element.name}床头`, "headboard", material, darken(color, 0.72), [0, -depth * 0.46, 0], [width, Math.max(70, depth * 0.06), Math.max(850, height + 260)]),
    ];
  }
  if (element.type === "sofa") {
    return [
      elementBox(element, `${element.id}-seat`, element.name, "sofa", material, color, [0, 0, 0], [width, depth, height * 0.48]),
      elementBox(element, `${element.id}-back`, `${element.name}靠背`, "sofa", material, darken(color, 0.9), [0, -depth * 0.41, height * 0.36], [width, depth * 0.18, height * 0.64]),
      elementBox(element, `${element.id}-arm-left`, `${element.name}扶手`, "sofa", material, darken(color, 0.94), [-width * 0.46, 0, height * 0.18], [width * 0.08, depth, height * 0.5]),
      elementBox(element, `${element.id}-arm-right`, `${element.name}扶手`, "sofa", material, darken(color, 0.94), [width * 0.46, 0, height * 0.18], [width * 0.08, depth, height * 0.5]),
    ];
  }
  if (element.type === "table") {
    const top = Math.min(80, Math.max(36, height * 0.1));
    const leg = Math.min(70, Math.max(38, Math.min(width, depth) * 0.1));
    const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y], index) => elementBox(element, `${element.id}-leg-${index + 1}`, `${element.name}桌腿`, "table-leg", material, darken(color, 0.72), [x * (width / 2 - leg), y * (depth / 2 - leg), 0], [leg, leg, Math.max(80, height - top)]));
    return [elementBox(element, `${element.id}-top`, element.name, "table", material, color, [0, 0, height - top], [width, depth, top]), ...legs];
  }
  if (element.type === "cabinet") {
    const panelDepth = Math.min(34, Math.max(18, depth * 0.06));
    const panelCount = Math.max(1, Math.min(6, Math.round(width / 650)));
    const panels = Array.from({ length: panelCount }, (_, index) => {
      const panelWidth = width / panelCount - 12;
      return elementBox(element, `${element.id}-front-${index + 1}`, `${element.name}门板`, "cabinet-front", material, lighten(color, 1.04), [-width / 2 + panelWidth / 2 + 6 + index * (width / panelCount), -depth / 2 - panelDepth / 2, 70], [panelWidth, panelDepth, Math.max(120, height - 90)]);
    });
    return [base, elementBox(element, `${element.id}-plinth`, `${element.name}踢脚`, "cabinet-plinth", material, darken(color, 0.62), [0, 0, 0], [width, depth, Math.min(80, height * 0.08)]), ...panels];
  }
  if (element.type === "appliance") {
    return [base, elementBox(element, `${element.id}-front`, `${element.name}面板`, "appliance-front", "metal", lighten(color, 1.18), [0, -depth / 2 - 12, Math.min(80, height * 0.08)], [width * 0.9, 24, height * 0.84])];
  }
  return [base];
}

function elementBox(element, id, name, kind, material, color, localOffset, size) {
  const angle = (element.rotationDeg || 0) * Math.PI / 180;
  const [localX, localY, localZ] = localOffset;
  const x = localX * Math.cos(angle) - localY * Math.sin(angle);
  const y = localX * Math.sin(angle) + localY * Math.cos(angle);
  return { id, name, kind, material, color, center: [element.position[0] + x, element.position[1] + y, element.position[2] + localZ], size, rotationDeg: element.rotationDeg || 0, roomId: element.roomId || null };
}

function materialColors(project) {
  const map = { floor: "#d7c7ae", wall: "#f2f0e9", glass: "#8fc4d2", frame: "#6f675c", sill: "#ddd8cf", door: "#b69a78", furniture: "#9c7f62", cabinet: "#876d55", sofa: "#8d9b91", bed: "#c9b9a6", table: "#8c7156", appliance: "#575d5d", sanitary: "#e8ece9", light: "#f1bd5d" };
  for (const entry of project.design?.materials || []) if (entry.id && /^#[0-9a-f]{6}$/i.test(entry.color || "")) map[entry.id] = entry.color;
  return map;
}

function darken(color, factor) { return adjustColor(color, factor); }
function lighten(color, factor) { return adjustColor(color, factor); }
function adjustColor(color, factor) {
  const safe = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#9c7f62";
  const channels = [1, 3, 5].map((start) => Math.max(0, Math.min(255, Math.round(Number.parseInt(safe.slice(start, start + 2), 16) * factor))));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function geometryBounds(geometry) {
  const points = [
    ...geometry.rooms.flatMap((room) => room.polygon || []),
    ...geometry.walls.flatMap((wall) => [wall.start, wall.end]),
    ...geometry.elements.flatMap((entry) => [[entry.position[0] - entry.size[0] / 2, entry.position[1] - entry.size[1] / 2], [entry.position[0] + entry.size[0] / 2, entry.position[1] + entry.size[1] / 2]]),
  ];
  if (!points.length) return { minX: 0, minY: 0, maxX: 10_000, maxY: 8_000 };
  return { minX: Math.min(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])), maxX: Math.max(...points.map((p) => p[0])), maxY: Math.max(...points.map((p) => p[1])) };
}

function polygonBounds(points) { return { minX: Math.min(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])), maxX: Math.max(...points.map((p) => p[0])), maxY: Math.max(...points.map((p) => p[1])) }; }
function polygonCentroid(points) { const bounds = polygonBounds(points); return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]; }
function openingSegment(wall, opening) { const length = wallLength(wall); const ux = (wall.end[0] - wall.start[0]) / length, uy = (wall.end[1] - wall.start[1]) / length; return [[wall.start[0] + ux * opening.offset, wall.start[1] + uy * opening.offset], [wall.start[0] + ux * (opening.offset + opening.width), wall.start[1] + uy * (opening.offset + opening.width)]]; }
function validPolygon(value) { return Array.isArray(value) && value.length >= 3 && value.length <= 256 && value.every(validPoint) && polygonArea(value) > 10_000; }
function validPoint(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite); }
function validPoint3(value) { return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite); }
function positive(value) { return Number.isFinite(value) && value > 0; }
function overlaps2d(left, right) { const [lw, ld] = left.size, [rw, rd] = right.size; return Math.abs(left.position[0] - right.position[0]) < (lw + rw) / 2 && Math.abs(left.position[1] - right.position[1]) < (ld + rd) / 2; }
function pointInsideElementFootprint(point, element, margin = 0) { const angle = -(element.rotationDeg || 0) * Math.PI / 180; const dx = point[0] - element.position[0], dy = point[1] - element.position[1]; const localX = dx * Math.cos(angle) - dy * Math.sin(angle), localY = dx * Math.sin(angle) + dy * Math.cos(angle); return Math.abs(localX) <= element.size[0] / 2 + margin && Math.abs(localY) <= element.size[1] / 2 + margin; }
function pointInPolygon(point, polygon) { let inside = false; for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) { const [xi, yi] = polygon[index], [xj, yj] = polygon[previous]; const crosses = (yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi; if (crosses) inside = !inside; } return inside; }
function pointColor(type) { if (/water|drain|basin|toilet/i.test(type)) return "#4f91b8"; if (/switch|socket|power/i.test(type)) return "#d98248"; return "#d9ae43"; }
function issue(issues, level, code, message, refs = []) { issues.push({ level, code, message, refs }); }
function round(value, digits) { const power = 10 ** digits; return Math.round(value * power) / power; }
function xml(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
