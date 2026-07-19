const hex = /^#[0-9a-f]{6}$/i;

export function validateModel(model) {
  const errors = [];
  if (!model || typeof model !== 'object') return ['model must be an object'];
  if (model.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!model.project?.id || !model.project?.title) errors.push('project.id and project.title are required');
  if (model.project?.status !== 'concept') errors.push('project.status must be concept');
  if (!['known-length', 'estimated', 'unknown'].includes(model.project?.scale?.basis)) errors.push('project.scale.basis is invalid');
  finitePositive(model.project?.scale?.metresPerUnit, 'project.scale.metresPerUnit', errors);
  finiteRange(model.project?.scale?.confidence, 0, 1, 'project.scale.confidence', errors);
  const collections = ['rooms', 'walls', 'openings', 'furniture', 'materials'];
  for (const name of collections) if (!Array.isArray(model[name])) errors.push(`${name} must be an array`);
  if (errors.length) return errors;

  const roomIds = ids(model.rooms, 'rooms', errors);
  const wallIds = ids(model.walls, 'walls', errors);
  ids(model.openings, 'openings', errors);
  ids(model.furniture, 'furniture', errors);
  const materialIds = ids(model.materials, 'materials', errors);

  for (const room of model.rooms) {
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) errors.push(`room ${room.id}: polygon needs 3 points`);
    else if (room.polygon.some((point) => !point2(point))) errors.push(`room ${room.id}: invalid polygon point`);
    else if (Math.abs(polygonArea(room.polygon)) < 0.01) errors.push(`room ${room.id}: polygon is degenerate`);
    finitePositive(room.height, `room ${room.id}: height`, errors);
    if (!materialIds.has(room.material)) errors.push(`room ${room.id}: material does not resolve`);
  }
  for (const wall of model.walls) {
    if (!point2(wall.from) || !point2(wall.to)) errors.push(`wall ${wall.id}: invalid endpoints`);
    finitePositive(wall.height, `wall ${wall.id}: height`, errors);
    finitePositive(wall.thickness, `wall ${wall.id}: thickness`, errors);
  }
  for (const opening of model.openings) {
    if (!wallIds.has(opening.wallId)) errors.push(`opening ${opening.id}: wallId does not resolve`);
    if (!['door', 'window'].includes(opening.kind)) errors.push(`opening ${opening.id}: kind is invalid`);
    finiteRange(opening.offset, 0, 1, `opening ${opening.id}: offset`, errors);
    finitePositive(opening.width, `opening ${opening.id}: width`, errors);
    finitePositive(opening.height, `opening ${opening.id}: height`, errors);
  }
  for (const item of model.furniture) {
    if (!roomIds.has(item.roomId)) errors.push(`furniture ${item.id}: roomId does not resolve`);
    if (!point2(item.position)) errors.push(`furniture ${item.id}: position is invalid`);
    if (!Array.isArray(item.size) || item.size.length !== 3 || item.size.some((v) => !positive(v))) errors.push(`furniture ${item.id}: size is invalid`);
    if (!Number.isFinite(item.rotation)) errors.push(`furniture ${item.id}: rotation is invalid`);
    if (!materialIds.has(item.material)) errors.push(`furniture ${item.id}: material does not resolve`);
  }
  for (const material of model.materials) {
    if (!hex.test(material.color || '')) errors.push(`material ${material.id}: color must be #RRGGBB`);
    finiteRange(material.roughness, 0, 1, `material ${material.id}: roughness`, errors);
  }
  if (!['day', 'evening'].includes(model.lighting?.mode)) errors.push('lighting.mode is invalid');
  finiteRange(model.lighting?.ambient, 0, 3, 'lighting.ambient', errors);
  if (typeof model.lighting?.shadows !== 'boolean') errors.push('lighting.shadows must be boolean');
  if (!['isometric', 'top', 'interior'].includes(model.camera?.initial)) errors.push('camera.initial is invalid');
  if (model.camera?.segments !== undefined && !Array.isArray(model.camera.segments)) errors.push('camera.segments must be an array when present');
  else for (const segment of model.camera?.segments || []) {
    finitePositive(segment.durationMs, `camera segment ${segment.id}: durationMs`, errors);
    if (segment.targetRoomId && !roomIds.has(segment.targetRoomId)) errors.push(`camera segment ${segment.id}: targetRoomId does not resolve`);
  }
  return errors;
}

export function normalizeModel(input) {
  const model = structuredClone(input);
  const points = [...model.rooms.flatMap((room) => room.polygon), ...model.walls.flatMap((wall) => [wall.from, wall.to])];
  const minX = Math.min(...points.map((point) => point[0]));
  const minZ = Math.min(...points.map((point) => point[1]));
  const scale = model.project.scale.metresPerUnit;
  const map = ([x, z]) => [round((x - minX) * scale), round((z - minZ) * scale)];
  for (const room of model.rooms) room.polygon = room.polygon.map(map);
  for (const wall of model.walls) { wall.from = map(wall.from); wall.to = map(wall.to); wall.height = round(wall.height * scale); wall.thickness = round(wall.thickness * scale); }
  for (const opening of model.openings) { opening.width = round(opening.width * scale); opening.height = round(opening.height * scale); }
  for (const item of model.furniture) { item.position = map(item.position); item.size = item.size.map((value) => round(value * scale)); }
  model.project.scale.normalizedToMetres = true;
  model.project.scale.metresPerUnit = 1;
  model.project.bounds = bounds(points.map(map));
  model.project.areaM2 = round(model.rooms.reduce((sum, room) => sum + Math.abs(polygonArea(room.polygon)), 0));
  return model;
}

function ids(items, label, errors) {
  const set = new Set();
  for (const item of items) {
    if (!item?.id) errors.push(`${label}: every item needs an id`);
    else if (set.has(item.id)) errors.push(`${label}: duplicate id ${item.id}`);
    else set.add(item.id);
  }
  return set;
}
function finitePositive(value, label, errors) { if (!positive(value)) errors.push(`${label} must be positive`); }
function finiteRange(value, min, max, label, errors) { if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max}`); }
function positive(value) { return Number.isFinite(value) && value > 0; }
function point2(point) { return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite); }
function polygonArea(points) { return points.reduce((sum, [x, z], index) => { const [nx, nz] = points[(index + 1) % points.length]; return sum + x * nz - nx * z; }, 0) / 2; }
function bounds(points) { const xs = points.map((p) => p[0]); const zs = points.map((p) => p[1]); return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }; }
function round(value) { return Math.round(value * 1000) / 1000; }
