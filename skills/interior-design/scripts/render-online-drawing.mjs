import { stableHash, wallLength } from "./geometry-v5.mjs";
import { ownerTitle } from "./owner-language-v5.mjs";

export const DRAWING_SHEETS = Object.freeze([
  { id: "p-01-plan-layout", title: "P-01 平面布置图", subtitle: "空间、门窗、家具、动线与连续尺寸", discipline: "P" },
  { id: "c-01-ceiling-lighting", title: "C-01 天花与灯具图", subtitle: "吊顶边界、标高、灯具定位与照明分区", discipline: "C" },
  { id: "e-01-switch-control", title: "E-01 开关控制图", subtitle: "开关回路、灯具控制关系与安装高度", discipline: "E" },
  { id: "e-02-socket-layout", title: "E-02 插座点位图", subtitle: "强弱电、专用回路、设备点位与安装高度", discipline: "E" },
  { id: "w-01-plumbing", title: "W-01 给排水图", subtitle: "冷热水、排水、地漏与用水设备关系", discipline: "W" },
  { id: "m-01-cabinet", title: "M-01 柜体深化图", subtitle: "柜体定位、模块划分、开启方向与概念尺寸", discipline: "M" },
]);

export function renderOnlineDrawingSvg(project, geometry, sheetId) {
  const sheet = DRAWING_SHEETS.find((entry) => entry.id === sheetId);
  if (!sheet) throw new Error(`unsupported online concept drawing: ${sheetId}`);
  const bounds = geometryBounds(geometry);
  const margin = 1050;
  const footer = sheetId === "m-01-cabinet" ? 2500 : 1250;
  const view = [bounds.minX - margin, bounds.minY - margin, bounds.width + margin * 2, bounds.height + margin * 2 + footer];
  const titleY = bounds.maxY + margin + 260;
  const plan = `${renderRooms(geometry.rooms, sheetId)}${renderWalls(geometry.walls)}${renderOpenings(geometry)}`;
  const content = renderSheetContent(sheetId, geometry, bounds, titleY);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(" ")}" role="img" aria-labelledby="sheet-title sheet-desc" data-sheet="${sheetId}" data-revision="${Number(project.revision)}" data-geometry-sha256="${stableHash(geometry)}">
  <title id="sheet-title">${xml(ownerTitle(project.title))} · ${sheet.title}</title>
  <desc id="sheet-desc">${sheet.subtitle}。这是用于业主沟通和设计确认的高细节概念图，尺寸单位为毫米；施工前须现场复尺并由相应专业人员深化。</desc>
  <style>${style()}</style>
  <rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#fffdf8"/>
  ${plan}${content}${renderDimensions(geometry, bounds)}
  <line class="sheet-line" x1="${view[0] + 80}" y1="${titleY - 300}" x2="${view[0] + view[2] - 80}" y2="${titleY - 300}"/>
  <text class="title" x="${view[0] + 120}" y="${titleY}">${sheet.title}</text>
  <text class="subtitle" x="${view[0] + 120}" y="${titleY + 220}">${xml(ownerTitle(project.title))} · ${sheet.subtitle}</text>
  <text class="meta" x="${view[0] + 120}" y="${titleY + 440}">REV ${Number(project.revision)} · 单位 mm · 设计确认图 · 非施工下单依据</text>
  ${renderLegend(sheetId, view, titleY)}
</svg>\n`;
}

function style() {
  return `
    .room{fill:#f7f3ea;stroke:#d8d0c3;stroke-width:14}.room.wet{fill:#e9f1ef}.room-label{font:650 150px system-ui,"Microsoft YaHei";fill:#343b38;text-anchor:middle;dominant-baseline:middle}.room-area{font:500 94px system-ui,"Microsoft YaHei";fill:#747d78;text-anchor:middle}.wall{stroke:#202522;stroke-linecap:square}.opening-cut{stroke:#fffdf8}.window-line{stroke:#3184a0;fill:none}.door-line{stroke:#b56c43;fill:none}.furniture{fill:#cabda8;fill-opacity:.58;stroke:#756958;stroke-width:18}.fixture{fill:#edf3f1;stroke:#64736d;stroke-width:18}.ceiling{fill:none;stroke:#9a8060;stroke-width:22;stroke-dasharray:70 38}.light{fill:#fffdf8;stroke:#d49a25;stroke-width:20}.control{fill:none;stroke:#ce6d38;stroke-width:18;stroke-dasharray:55 34}.power{fill:#fffdf8;stroke:#b54e35;stroke-width:20}.cold{fill:none;stroke:#2b86b8;stroke-width:25}.hot{fill:none;stroke:#d4523f;stroke-width:25}.drain{fill:none;stroke:#55746a;stroke-width:38;stroke-dasharray:70 35}.cabinet{fill:#cbb596;stroke:#725d43;stroke-width:24}.swing{fill:none;stroke:#8b745a;stroke-width:16}.label{font:550 96px system-ui,"Microsoft YaHei";fill:#37403c}.small{font:500 78px system-ui,"Microsoft YaHei";fill:#68716d}.callout{font:650 86px ui-monospace,Consolas;fill:#fffdf8;text-anchor:middle;dominant-baseline:middle}.callout-bg{fill:#2d3733}.dim{stroke:#857b6e;stroke-width:12;fill:none}.dim-ext{stroke:#b3aa9d;stroke-width:10}.dim-text{font:500 88px ui-monospace,Consolas;fill:#6b6359;text-anchor:middle}.title{font:720 210px system-ui,"Microsoft YaHei";fill:#202522}.subtitle{font:520 112px system-ui,"Microsoft YaHei";fill:#67716c}.meta{font:520 92px system-ui,"Microsoft YaHei";fill:#67716c}.legend{font:520 90px system-ui,"Microsoft YaHei";fill:#38413d}.sheet-line{stroke:#cfc8bc;stroke-width:14}.symbol{fill:#fffdf8;stroke-width:20}`;
}

function renderRooms(rooms, sheetId) {
  return rooms.map((room) => {
    const center = polygonCenter(room.polygon);
    const area = polygonArea(room.polygon) / 1_000_000;
    const wet = /厨|卫|阳台|kitchen|bath/i.test(room.name ?? room.id);
    const muted = sheetId === "m-01-cabinet" ? " fill-opacity=\".28\"" : "";
    return `<g data-room="${xml(room.id)}"><polygon class="room${wet ? " wet" : ""}" points="${room.polygon.map((point) => point.join(",")).join(" ")}"${muted}/><text class="room-label" x="${center[0]}" y="${center[1] - 40}">${xml(room.name || room.id)}</text><text class="room-area" x="${center[0]}" y="${center[1] + 125}">${area.toFixed(1)}㎡</text></g>`;
  }).join("");
}

function renderWalls(walls) {
  return walls.map((wall) => `<line class="wall" data-wall="${xml(wall.id)}" x1="${wall.start[0]}" y1="${wall.start[1]}" x2="${wall.end[0]}" y2="${wall.end[1]}" stroke-width="${wall.thickness}"/>`).join("");
}

function renderOpenings(geometry) {
  return geometry.openings.map((opening) => {
    const wall = geometry.walls.find((entry) => entry.id === opening.wallId);
    if (!wall) return "";
    const [start, end] = openingSegment(wall, opening);
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const width = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (opening.type === "window") {
      return `<g data-opening="${xml(opening.id)}"><line class="opening-cut" x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke-width="${wall.thickness + 70}"/><line class="window-line" x1="${start[0] + nx * 35}" y1="${start[1] + ny * 35}" x2="${end[0] + nx * 35}" y2="${end[1] + ny * 35}" stroke-width="26"/><line class="window-line" x1="${start[0] - nx * 35}" y1="${start[1] - ny * 35}" x2="${end[0] - nx * 35}" y2="${end[1] - ny * 35}" stroke-width="26"/></g>`;
    }
    const sweep = opening.swing === "right" ? 0 : 1;
    const leafX = start[0] + nx * width;
    const leafY = start[1] + ny * width;
    return `<g data-opening="${xml(opening.id)}"><line class="opening-cut" x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke-width="${wall.thickness + 70}"/><line class="door-line" x1="${start[0]}" y1="${start[1]}" x2="${leafX}" y2="${leafY}" stroke-width="28"/><path class="door-line" d="M ${end[0]} ${end[1]} A ${width} ${width} 0 0 ${sweep} ${leafX} ${leafY}" stroke-width="16"/></g>`;
  }).join("");
}

function renderSheetContent(sheetId, geometry, bounds, titleY) {
  if (sheetId === "p-01-plan-layout") return renderElements(geometry.elements) + renderRoomDimensions(geometry.rooms);
  if (sheetId === "c-01-ceiling-lighting") return renderCeilings(geometry) + renderPoints(geometry.points, ["light"], "light");
  if (sheetId === "e-01-switch-control") return renderPoints(geometry.points, ["switch", "light"], "control") + renderControls(geometry);
  if (sheetId === "e-02-socket-layout") return renderPoints(geometry.points, ["socket", "power", "network", "tv", "ac"], "power");
  if (sheetId === "w-01-plumbing") return renderPlumbing(geometry);
  return renderCabinets(geometry, bounds, titleY);
}

function renderElements(elements = []) {
  return elements.map((entry) => `<g data-element="${xml(entry.id)}" transform="translate(${entry.position[0]} ${entry.position[1]}) rotate(${entry.rotationDeg || 0})"><rect class="${entry.type === "sanitary" ? "fixture" : "furniture"}" x="${-entry.size[0] / 2}" y="${-entry.size[1] / 2}" width="${entry.size[0]}" height="${entry.size[1]}" rx="30"/><text class="small" text-anchor="middle" y="10">${xml(entry.name || entry.type)}</text></g>`).join("");
}

function renderCeilings(geometry) {
  const zones = geometry.ceilingZones?.length ? geometry.ceilingZones : geometry.rooms.map((room) => ({ id: `ceiling-${room.id}`, polygon: room.polygon, elevation: 2600 }));
  return zones.map((zone) => {
    const center = polygonCenter(zone.polygon);
    return `<g data-ceiling="${xml(zone.id)}"><polygon class="ceiling" points="${zone.polygon.map((point) => point.join(",")).join(" ")}"/><text class="label" x="${center[0]}" y="${center[1] + 280}" text-anchor="middle">CH ${zone.elevation ?? 2600}</text></g>`;
  }).join("");
}

function renderPoints(points = [], tokens, mode) {
  return points.filter((entry) => tokens.some((token) => String(entry.type).toLowerCase().includes(token))).map((entry, index) => {
    const type = String(entry.type).toLowerCase();
    const label = entry.label || entry.name || entry.type;
    const height = entry.height ?? entry.mountingHeight ?? (mode === "power" ? 300 : 1300);
    const symbol = type.includes("light") ? `<circle class="light" r="78"/><line class="light" x1="-52" y1="-52" x2="52" y2="52"/><line class="light" x1="52" y1="-52" x2="-52" y2="52"/>` : type.includes("switch") ? `<rect class="symbol" x="-68" y="-68" width="136" height="136" rx="16" stroke="#ce6d38"/><text class="label" text-anchor="middle" y="32">S</text>` : `<circle class="power" r="76"/><circle cx="-24" r="9" fill="#b54e35"/><circle cx="24" r="9" fill="#b54e35"/>`;
    return `<g data-point="${xml(entry.id)}" transform="translate(${entry.position[0]} ${entry.position[1]})">${symbol}<circle class="callout-bg" cx="105" cy="-110" r="54"/><text class="callout" x="105" y="-105">${index + 1}</text><text class="small" x="170" y="-105">${xml(label)} · H${height}</text></g>`;
  }).join("");
}

function renderControls(geometry) {
  const explicit = geometry.circuits ?? [];
  if (explicit.length) return explicit.map((circuit) => `<polyline class="control" data-circuit="${xml(circuit.id)}" points="${circuit.path.map((point) => point.join(",")).join(" ")}"/>`).join("");
  const lights = geometry.points.filter((point) => /light/i.test(point.type));
  const switches = geometry.points.filter((point) => /switch/i.test(point.type));
  return switches.map((entry, index) => {
    const target = lights[index % Math.max(1, lights.length)];
    return target ? `<path class="control" d="M ${entry.position[0]} ${entry.position[1]} Q ${(entry.position[0] + target.position[0]) / 2} ${entry.position[1] - 350} ${target.position[0]} ${target.position[1]}"/>` : "";
  }).join("");
}

function renderPlumbing(geometry) {
  const runs = geometry.plumbingRuns ?? [];
  const lines = runs.map((run) => `<polyline class="${run.kind === "hot" ? "hot" : run.kind === "drain" ? "drain" : "cold"}" data-run="${xml(run.id)}" points="${run.path.map((point) => point.join(",")).join(" ")}"/>`).join("");
  return lines + renderPoints(geometry.points, ["water", "drain", "basin", "toilet"], "water");
}

function renderCabinets(geometry, bounds, titleY) {
  const modules = geometry.cabinetModules?.length ? geometry.cabinetModules : geometry.elements.filter((entry) => /cabinet|wardrobe|柜/i.test(`${entry.type} ${entry.name}`)).map((entry) => ({ ...entry, width: entry.size[0], depth: entry.size[1], height: entry.size[2] ?? 2400 }));
  const plan = modules.map((entry) => `<g data-cabinet="${xml(entry.id)}" transform="translate(${entry.position[0]} ${entry.position[1]}) rotate(${entry.rotationDeg || 0})"><rect class="cabinet" x="${-(entry.width ?? 600) / 2}" y="${-(entry.depth ?? 600) / 2}" width="${entry.width ?? 600}" height="${entry.depth ?? 600}"/><line class="swing" x1="0" y1="${-(entry.depth ?? 600) / 2}" x2="0" y2="${(entry.depth ?? 600) / 2}"/></g>`).join("");
  let cursor = bounds.minX;
  const elevationY = titleY + 850;
  const elevations = modules.slice(0, 8).map((entry, index) => {
    const width = entry.width ?? 600;
    const scaledWidth = Math.min(width, 1500);
    const x = cursor;
    cursor += scaledWidth + 140;
    return `<g data-cabinet-elevation="${xml(entry.id)}"><rect class="cabinet" x="${x}" y="${elevationY}" width="${scaledWidth}" height="900"/><line class="swing" x1="${x + scaledWidth / 2}" y1="${elevationY}" x2="${x + scaledWidth / 2}" y2="${elevationY + 900}"/><text class="small" x="${x + scaledWidth / 2}" y="${elevationY + 1040}" text-anchor="middle">M${index + 1} · W${width} H${entry.height ?? 2400}</text></g>`;
  }).join("");
  return plan + elevations;
}

function renderDimensions(geometry, bounds) {
  const overall = dimensionLine(bounds.minX, bounds.maxX, bounds.minY - 520, Math.round(bounds.width), false) + dimensionLine(bounds.minY, bounds.maxY, bounds.minX - 520, Math.round(bounds.height), true);
  const chains = [...new Set(geometry.walls.map((wall) => Math.round(wallLength(wall))))].slice(0, 12);
  return `<g aria-label="尺寸标注">${overall}<text class="small" x="${bounds.maxX}" y="${bounds.minY - 720}" text-anchor="end">墙段尺寸：${chains.join(" / ")}</text></g>`;
}

function renderRoomDimensions(rooms) {
  return rooms.map((room) => {
    const xs = room.polygon.map((point) => point[0]);
    const ys = room.polygon.map((point) => point[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    return `<text class="dim-text" x="${(minX + maxX) / 2}" y="${maxY - 80}">${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}</text>`;
  }).join("");
}

function dimensionLine(start, end, axis, value, vertical) {
  if (!vertical) return `<line class="dim" x1="${start}" y1="${axis}" x2="${end}" y2="${axis}"/><line class="dim-ext" x1="${start}" y1="${axis - 90}" x2="${start}" y2="${axis + 90}"/><line class="dim-ext" x1="${end}" y1="${axis - 90}" x2="${end}" y2="${axis + 90}"/><text class="dim-text" x="${(start + end) / 2}" y="${axis - 70}">${value}</text>`;
  return `<line class="dim" x1="${axis}" y1="${start}" x2="${axis}" y2="${end}"/><line class="dim-ext" x1="${axis - 90}" y1="${start}" x2="${axis + 90}" y2="${start}"/><line class="dim-ext" x1="${axis - 90}" y1="${end}" x2="${axis + 90}" y2="${end}"/><text class="dim-text" transform="translate(${axis - 70} ${(start + end) / 2}) rotate(-90)">${value}</text>`;
}

function renderLegend(sheetId, view, titleY) {
  const legends = {
    "p-01-plan-layout": ["门窗开启", "家具定位", "房间净尺寸"],
    "c-01-ceiling-lighting": ["虚线=吊顶边界", "CH=完成面标高", "黄圈=灯具"],
    "e-01-switch-control": ["S=开关", "虚线=控制关系", "H=安装高度"],
    "e-02-socket-layout": ["圆圈=插座", "标注设备用途", "H=安装高度"],
    "w-01-plumbing": ["蓝=冷水", "红=热水", "虚线=排水"],
    "m-01-cabinet": ["M=柜体模块", "平面定位+立面分格", "尺寸待复尺"],
  };
  return `<text class="legend" x="${view[0] + view[2] - 120}" y="${titleY + 90}" text-anchor="end">${legends[sheetId].join(" · ")}</text>`;
}

function geometryBounds(geometry) {
  const points = [...geometry.rooms.flatMap((room) => room.polygon || []), ...geometry.walls.flatMap((wall) => [wall.start, wall.end])];
  const minX = Math.min(...points.map((point) => point[0])); const minY = Math.min(...points.map((point) => point[1]));
  const maxX = Math.max(...points.map((point) => point[0])); const maxY = Math.max(...points.map((point) => point[1]));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function openingSegment(wall, opening) {
  const length = wallLength(wall); const ux = (wall.end[0] - wall.start[0]) / length; const uy = (wall.end[1] - wall.start[1]) / length;
  return [[wall.start[0] + ux * opening.offset, wall.start[1] + uy * opening.offset], [wall.start[0] + ux * (opening.offset + opening.width), wall.start[1] + uy * (opening.offset + opening.width)]];
}
function polygonCenter(points) { return [(Math.min(...points.map((point) => point[0])) + Math.max(...points.map((point) => point[0]))) / 2, (Math.min(...points.map((point) => point[1])) + Math.max(...points.map((point) => point[1]))) / 2]; }
function polygonArea(points) { return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2); }
function xml(value) { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char]); }
