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

  const levelIds = validateLevels(model.levels, errors);
  const roomIds = ids(model.rooms, 'rooms', errors);
  const wallIds = ids(model.walls, 'walls', errors);
  ids(model.openings, 'openings', errors);
  ids(model.furniture, 'furniture', errors);
  const materialIds = ids(model.materials, 'materials', errors);
  const levelReference = (item, label) => {
    if (item.levelId !== undefined && !levelIds.has(item.levelId)) errors.push(`${label}: levelId does not resolve`);
    if (item.elevation !== undefined && !Number.isFinite(item.elevation)) errors.push(`${label}: elevation must be finite`);
  };

  for (const room of model.rooms) {
    validatePolygon(room.polygon, `room ${room.id}: polygon`, errors);
    finitePositive(room.height, `room ${room.id}: height`, errors);
    if (!materialIds.has(room.material)) errors.push(`room ${room.id}: material does not resolve`);
    levelReference(room, `room ${room.id}`);
  }
  for (const wall of model.walls) {
    if (!point2(wall.from) || !point2(wall.to)) errors.push(`wall ${wall.id}: invalid endpoints`);
    finitePositive(wall.height, `wall ${wall.id}: height`, errors);
    finitePositive(wall.thickness, `wall ${wall.id}: thickness`, errors);
    if (wall.sectionHidden !== undefined && typeof wall.sectionHidden !== 'boolean') errors.push(`wall ${wall.id}: sectionHidden must be boolean`);
    levelReference(wall, `wall ${wall.id}`);
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
    if (!Array.isArray(item.size) || item.size.length !== 3 || item.size.some((value) => !positive(value))) errors.push(`furniture ${item.id}: size is invalid`);
    if (!Number.isFinite(item.rotation)) errors.push(`furniture ${item.id}: rotation is invalid`);
    if (!materialIds.has(item.material)) errors.push(`furniture ${item.id}: material does not resolve`);
    levelReference(item, `furniture ${item.id}`);
  }
  for (const material of model.materials) {
    if (!hex.test(material.color || '')) errors.push(`material ${material.id}: color must be #RRGGBB`);
    finiteRange(material.roughness, 0, 1, `material ${material.id}: roughness`, errors);
    if (material.opacity !== undefined) finiteRange(material.opacity, 0, 1, `material ${material.id}: opacity`, errors);
  }
  validateVerticalElements(model, { errors, levelIds, materialIds });
  if (!['day', 'evening'].includes(model.lighting?.mode)) errors.push('lighting.mode is invalid');
  finiteRange(model.lighting?.ambient, 0, 3, 'lighting.ambient', errors);
  if (typeof model.lighting?.shadows !== 'boolean') errors.push('lighting.shadows must be boolean');
  if (!['isometric', 'top', 'interior'].includes(model.camera?.initial)) errors.push('camera.initial is invalid');
  if (model.presentation?.revealDurationMs !== undefined) finiteRange(model.presentation.revealDurationMs, 400, 5000, 'presentation.revealDurationMs', errors);
  if (model.camera?.segments !== undefined && !Array.isArray(model.camera.segments)) errors.push('camera.segments must be an array when present');
  else for (const segment of model.camera?.segments || []) {
    finitePositive(segment.durationMs, `camera segment ${segment.id}: durationMs`, errors);
    if (segment.targetRoomId && !roomIds.has(segment.targetRoomId)) errors.push(`camera segment ${segment.id}: targetRoomId does not resolve`);
  }
  return errors;
}

export function normalizeModel(input) {
  const model = structuredClone(input);
  const coordinatePoints = collectPlanPoints(model);
  const minX = Math.min(...coordinatePoints.map((point) => point[0]));
  const minZ = Math.min(...coordinatePoints.map((point) => point[1]));
  const scale = model.project.scale.metresPerUnit;
  const map = ([x, z]) => [round((x - minX) * scale), round((z - minZ) * scale)];
  const vertical = (value) => round(value * scale);

  for (const room of model.rooms) {
    room.polygon = room.polygon.map(map);
    room.height = vertical(room.height);
    if (room.elevation !== undefined) room.elevation = vertical(room.elevation);
  }
  for (const wall of model.walls) {
    wall.from = map(wall.from); wall.to = map(wall.to);
    wall.height = vertical(wall.height); wall.thickness = vertical(wall.thickness);
    if (wall.elevation !== undefined) wall.elevation = vertical(wall.elevation);
  }
  for (const opening of model.openings) { opening.width = vertical(opening.width); opening.height = vertical(opening.height); }
  for (const item of model.furniture) {
    item.position = map(item.position); item.size = item.size.map(vertical);
    if (item.elevation !== undefined) item.elevation = vertical(item.elevation);
  }
  for (const level of model.levels || []) { level.elevation = vertical(level.elevation); level.height = vertical(level.height); }
  for (const slab of model.slabs || []) { slab.polygon = slab.polygon.map(map); slab.elevation = vertical(slab.elevation); slab.thickness = vertical(slab.thickness); }
  for (const voidItem of model.voids || []) { voidItem.polygon = voidItem.polygon.map(map); voidItem.bottomElevation = vertical(voidItem.bottomElevation); voidItem.height = vertical(voidItem.height); }
  for (const stair of model.stairs || []) { stair.start = map(stair.start); stair.end = map(stair.end); stair.width = vertical(stair.width); stair.rise = vertical(stair.rise); }
  for (const railing of model.railings || []) { railing.points = railing.points.map(map); railing.elevation = vertical(railing.elevation); railing.height = vertical(railing.height); }
  model.project.scale.normalizedToMetres = true;
  model.project.scale.metresPerUnit = 1;
  const normalizedPoints = coordinatePoints.map(map);
  model.project.bounds = bounds(normalizedPoints);
  const levelAreas = Object.fromEntries(effectiveLevels(model).map((level) => [level.id, round(model.rooms
    .filter((room) => effectiveLevelId(room) === level.id)
    .reduce((sum, room) => sum + Math.abs(polygonArea(room.polygon)), 0))]));
  model.project.levelAreasM2 = levelAreas;
  model.project.designedFloorAreaM2 = round(Object.values(levelAreas).reduce((sum, value) => sum + value, 0));
  const sourceArea = Number(model.project.sourceAreaM2);
  model.project.areaM2 = Number.isFinite(sourceArea) && sourceArea > 0 ? round(sourceArea) : levelAreas[effectiveLevels(model)[0].id];
  return model;
}

function validateLevels(levels, errors) {
  if (levels === undefined) return new Set(['lower']);
  if (!Array.isArray(levels) || !levels.length) { errors.push('levels must be a non-empty array when present'); return new Set(); }
  const levelIds = ids(levels, 'levels', errors);
  for (const level of levels) {
    if (!level.name) errors.push(`level ${level.id}: name is required`);
    if (!Number.isFinite(level.elevation) || level.elevation < 0) errors.push(`level ${level.id}: elevation must be zero or positive`);
    finitePositive(level.height, `level ${level.id}: height`, errors);
  }
  return levelIds;
}

function validateVerticalElements(model, { errors, levelIds, materialIds }) {
  for (const name of ['slabs', 'voids', 'stairs', 'railings']) if (model[name] !== undefined && !Array.isArray(model[name])) errors.push(`${name} must be an array when present`);
  ids(model.slabs || [], 'slabs', errors); ids(model.voids || [], 'voids', errors); ids(model.stairs || [], 'stairs', errors); ids(model.railings || [], 'railings', errors);
  for (const slab of model.slabs || []) {
    validatePolygon(slab.polygon, `slab ${slab.id}: polygon`, errors);
    if (!levelIds.has(slab.levelId)) errors.push(`slab ${slab.id}: levelId does not resolve`);
    if (!['floor', 'bridge'].includes(slab.kind)) errors.push(`slab ${slab.id}: kind is invalid`);
    if (!Number.isFinite(slab.elevation)) errors.push(`slab ${slab.id}: elevation must be finite`);
    finitePositive(slab.thickness, `slab ${slab.id}: thickness`, errors);
    if (!materialIds.has(slab.material)) errors.push(`slab ${slab.id}: material does not resolve`);
  }
  for (const voidItem of model.voids || []) {
    validatePolygon(voidItem.polygon, `void ${voidItem.id}: polygon`, errors);
    if (!Number.isFinite(voidItem.bottomElevation)) errors.push(`void ${voidItem.id}: bottomElevation must be finite`);
    finitePositive(voidItem.height, `void ${voidItem.id}: height`, errors);
  }
  for (const stair of model.stairs || []) {
    if (!levelIds.has(stair.fromLevelId) || !levelIds.has(stair.toLevelId)) errors.push(`stair ${stair.id}: level reference does not resolve`);
    if (!point2(stair.start) || !point2(stair.end)) errors.push(`stair ${stair.id}: endpoints are invalid`);
    finitePositive(stair.width, `stair ${stair.id}: width`, errors);
    if (!Number.isInteger(stair.steps) || stair.steps < 2) errors.push(`stair ${stair.id}: steps must be an integer >= 2`);
    finitePositive(stair.rise, `stair ${stair.id}: rise`, errors);
    if (!materialIds.has(stair.material)) errors.push(`stair ${stair.id}: material does not resolve`);
  }
  for (const railing of model.railings || []) {
    if (!Array.isArray(railing.points) || railing.points.length < 2 || railing.points.some((point) => !point2(point))) errors.push(`railing ${railing.id}: points need at least 2 valid points`);
    if (!levelIds.has(railing.levelId)) errors.push(`railing ${railing.id}: levelId does not resolve`);
    if (!Number.isFinite(railing.elevation)) errors.push(`railing ${railing.id}: elevation must be finite`);
    finitePositive(railing.height, `railing ${railing.id}: height`, errors);
    if (!materialIds.has(railing.material)) errors.push(`railing ${railing.id}: material does not resolve`);
  }
}

function collectPlanPoints(model) {
  return [
    ...model.rooms.flatMap((room) => room.polygon),
    ...model.walls.flatMap((wall) => [wall.from, wall.to]),
    ...(model.slabs || []).flatMap((slab) => slab.polygon),
    ...(model.voids || []).flatMap((voidItem) => voidItem.polygon),
    ...(model.stairs || []).flatMap((stair) => [stair.start, stair.end]),
    ...(model.railings || []).flatMap((railing) => railing.points),
  ];
}

function effectiveLevels(model) { return model.levels?.length ? model.levels : [{ id: 'lower', name: 'Lower level', elevation: 0, height: 2.8 }]; }
function effectiveLevelId(item) { return item.levelId || 'lower'; }
function validatePolygon(polygon, label, errors) {
  if (!Array.isArray(polygon) || polygon.length < 3) errors.push(`${label} needs 3 points`);
  else if (polygon.some((point) => !point2(point))) errors.push(`${label} has an invalid point`);
  else if (Math.abs(polygonArea(polygon)) < 0.01) errors.push(`${label} is degenerate`);
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
function bounds(points) { const xs = points.map((point) => point[0]); const zs = points.map((point) => point[1]); return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }; }
function round(value) { return Math.round(value * 1000) / 1000; }
