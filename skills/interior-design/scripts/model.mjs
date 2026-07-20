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
  const furnitureIds = ids(model.furniture, 'furniture', errors);
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
    if (opening.roomId !== undefined && !roomIds.has(opening.roomId)) errors.push(`opening ${opening.id}: roomId does not resolve`);
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
    if (material.metalness !== undefined) finiteRange(material.metalness, 0, 1, `material ${material.id}: metalness`, errors);
    if (material.pattern !== undefined && !['wood', 'stone', 'fabric', 'matte'].includes(material.pattern)) errors.push(`material ${material.id}: pattern is invalid`);
  }
  validateVerticalElements(model, { errors, levelIds, materialIds, roomIds });
  validateDesignViews(model, { errors, roomIds, furnitureIds });
  validateConceptAssertions(model, errors);
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
  for (const route of model.circulationPaths || []) route.points = route.points.map(map);
  for (const annotation of model.annotations || []) annotation.position = map(annotation.position);
  if (model.assertions?.doubleHeightM !== undefined) model.assertions.doubleHeightM = vertical(model.assertions.doubleHeightM);
  if (model.assertions?.maxStandardLowerHeight !== undefined) model.assertions.maxStandardLowerHeight = vertical(model.assertions.maxStandardLowerHeight);
  if (model.assertions?.maxRoomHeight !== undefined) model.assertions.maxRoomHeight = vertical(model.assertions.maxRoomHeight);
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

function validateVerticalElements(model, { errors, levelIds, materialIds, roomIds }) {
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
    if (voidItem.roomId !== undefined && !roomIds.has(voidItem.roomId)) errors.push(`void ${voidItem.id}: roomId does not resolve`);
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

function validateConceptAssertions(model, errors) {
  const rules = model.assertions;
  if (rules === undefined) return;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) { errors.push('assertions must be an object when present'); return; }
  if (rules.singleLevelOnly) {
    if ((model.levels || []).length > 1) errors.push('assertions.singleLevelOnly forbids multiple levels');
    for (const name of ['slabs', 'voids', 'stairs', 'railings']) if ((model[name] || []).length) errors.push(`assertions.singleLevelOnly forbids ${name}`);
    if (Number.isFinite(rules.maxRoomHeight)) for (const room of model.rooms) if (room.height > rules.maxRoomHeight) errors.push(`room ${room.id}: height exceeds assertions.maxRoomHeight`);
    return;
  }
  const targetId = rules.singleDoubleHeightRoomId;
  const lowerRooms = model.rooms.filter((room) => effectiveLevelId(room) === 'lower');
  const target = lowerRooms.find((room) => room.id === targetId);
  const voids = model.voids || [];
  if (!targetId || !target) errors.push('assertions.singleDoubleHeightRoomId must resolve to a lower room');
  if (voids.length !== 1) errors.push('assertions require exactly one void');
  const voidItem = voids[0];
  if (voidItem && target) {
    if (voidItem.roomId !== targetId) errors.push(`void ${voidItem.id}: roomId must equal ${targetId}`);
    if (!voidItem.polygon.every((point) => pointInPolygon(point, target.polygon, true))) errors.push(`void ${voidItem.id}: polygon must stay inside room ${targetId}`);
    const requiredHeight = rules.doubleHeightM;
    if (Number.isFinite(requiredHeight) && Math.abs(voidItem.height - requiredHeight) > 0.01) errors.push(`void ${voidItem.id}: height must equal assertions.doubleHeightM`);
    for (const room of lowerRooms) {
      if (room.id !== targetId && polygonsOverlapArea(voidItem.polygon, room.polygon)) errors.push(`void ${voidItem.id}: overlaps non-target room ${room.id}`);
    }
    if (rules.requireUpperSlabExcludesVoid && (model.slabs || []).some((slab) => slab.levelId === 'upper' && polygonsOverlapArea(slab.polygon, voidItem.polygon))) {
      errors.push(`upper slab overlaps void ${voidItem.id}`);
    }
  }
  if (Number.isFinite(rules.maxStandardLowerHeight)) {
    for (const room of lowerRooms) if (room.id !== targetId && room.height >= rules.maxStandardLowerHeight) errors.push(`room ${room.id}: non-target lower height must be below ${rules.maxStandardLowerHeight}`);
  }
  if (Array.isArray(rules.upperCoverageRoomIds)) {
    const upperSlabs = (model.slabs || []).filter((slab) => slab.levelId === 'upper');
    for (const roomId of rules.upperCoverageRoomIds) {
      const room = lowerRooms.find((item) => item.id === roomId);
      if (!room) { errors.push(`assertions.upperCoverageRoomIds: ${roomId} does not resolve to a lower room`); continue; }
      if (!room.polygon.every((point) => upperSlabs.some((slab) => pointInPolygon(point, slab.polygon, true)))) errors.push(`room ${roomId}: is not covered by upper slabs`);
    }
  }
  if (rules.requireStairConnectsLevels && !(model.stairs || []).some((stair) => stair.fromLevelId === 'lower' && stair.toLevelId === 'upper')) errors.push('assertions require a stair connecting lower and upper');
}

function validateDesignViews(model, { errors, roomIds, furnitureIds }) {
  if (model.views !== undefined && (!Array.isArray(model.views) || !model.views.length)) errors.push('views must be a non-empty array when present');
  ids(model.views || [], 'views', errors);
  for (const view of model.views || []) {
    if (!view.label) errors.push(`view ${view.id}: label is required`);
    if (!Array.isArray(view.roomIds) || view.roomIds.some((id) => !roomIds.has(id))) errors.push(`view ${view.id}: roomIds must resolve`);
    if (view.furnitureIds !== undefined && (!Array.isArray(view.furnitureIds) || view.furnitureIds.some((id) => !furnitureIds.has(id)))) errors.push(`view ${view.id}: furnitureIds must resolve`);
    if (view.showCirculation !== undefined && typeof view.showCirculation !== 'boolean') errors.push(`view ${view.id}: showCirculation must be boolean`);
  }
  if (model.circulationPaths !== undefined && !Array.isArray(model.circulationPaths)) errors.push('circulationPaths must be an array when present');
  ids(model.circulationPaths || [], 'circulationPaths', errors);
  for (const route of model.circulationPaths || []) {
    if (!route.name) errors.push(`circulation path ${route.id}: name is required`);
    if (!Array.isArray(route.points) || route.points.length < 2 || route.points.some((point) => !point2(point))) errors.push(`circulation path ${route.id}: points need at least 2 valid points`);
    if (!hex.test(route.color || '')) errors.push(`circulation path ${route.id}: color must be #RRGGBB`);
  }
  if (model.annotations !== undefined && !Array.isArray(model.annotations)) errors.push('annotations must be an array when present');
  ids(model.annotations || [], 'annotations', errors);
  for (const annotation of model.annotations || []) {
    if (!['dimension', 'direction', 'furniture', 'opening'].includes(annotation.category)) errors.push(`annotation ${annotation.id}: category is invalid`);
    if (!annotation.text || !point2(annotation.position)) errors.push(`annotation ${annotation.id}: text and position are required`);
    if (annotation.roomId !== undefined && !roomIds.has(annotation.roomId)) errors.push(`annotation ${annotation.id}: roomId does not resolve`);
    if (annotation.evidence !== undefined && !['visible', 'dimension-chain', 'estimated'].includes(annotation.evidence)) errors.push(`annotation ${annotation.id}: evidence is invalid`);
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
    ...(model.circulationPaths || []).flatMap((route) => route.points),
    ...(model.annotations || []).map((annotation) => annotation.position),
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
function pointInPolygon(point, polygon, inclusive = false) {
  const boundary = polygon.some((next, index) => pointOnSegment(point, next, polygon[(index + 1) % polygon.length]));
  if (boundary) return inclusive;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index]; const [xj, zj] = polygon[previous];
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function pointOnSegment(point, from, to) {
  const cross = (point[0] - from[0]) * (to[1] - from[1]) - (point[1] - from[1]) * (to[0] - from[0]);
  return Math.abs(cross) < 1e-8 && point[0] >= Math.min(from[0], to[0]) - 1e-8 && point[0] <= Math.max(from[0], to[0]) + 1e-8 && point[1] >= Math.min(from[1], to[1]) - 1e-8 && point[1] <= Math.max(from[1], to[1]) + 1e-8;
}
function polygonsOverlapArea(first, second) {
  for (let a = 0; a < first.length; a += 1) for (let b = 0; b < second.length; b += 1) {
    const p1 = first[a]; const p2 = first[(a + 1) % first.length]; const q1 = second[b]; const q2 = second[(b + 1) % second.length];
    const c1 = cross(p1, p2, q1); const c2 = cross(p1, p2, q2); const c3 = cross(q1, q2, p1); const c4 = cross(q1, q2, p2);
    if (c1 * c2 < -1e-10 && c3 * c4 < -1e-10) return true;
  }
  const centroid = (polygon) => polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]);
  const edgeMidpoints = (polygon) => polygon.map((point, index) => { const next = polygon[(index + 1) % polygon.length]; return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]; });
  return first.some((point) => pointInPolygon(point, second)) || second.some((point) => pointInPolygon(point, first)) || edgeMidpoints(first).some((point) => pointInPolygon(point, second)) || edgeMidpoints(second).some((point) => pointInPolygon(point, first)) || pointInPolygon(centroid(first), second) || pointInPolygon(centroid(second), first);
}
function cross(from, to, point) { return (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0]); }
function bounds(points) { const xs = points.map((point) => point[0]); const zs = points.map((point) => point[1]); return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }; }
function round(value) { return Math.round(value * 1000) / 1000; }
