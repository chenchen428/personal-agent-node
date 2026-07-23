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

export function auditModel(model) {
  const errors = validateModel(model);
  if (errors.length) return { ok: false, errors, findings: [] };

  const findings = [];
  const review = model.qualityReview;
  if (!review || review.status !== 'passed') {
    findings.push(finding('quality-review-missing', 'Quality walkthrough must be recorded with status passed.'));
  } else {
    const requiredChecks = ['furnitureCollision', 'doorClearance', 'circulation', 'useClearance', 'lifestyleFit', 'labelLayout', 'templateContract', 'responsiveContract'];
    for (const name of requiredChecks) {
      if (review.checks?.[name] !== true) findings.push(finding(`quality-check-${name}`, `Quality walkthrough check ${name} must pass.`));
    }
    if (!Array.isArray(review.requirementTrace) || review.requirementTrace.length === 0) {
      findings.push(finding('requirement-trace-missing', 'At least one user requirement must be traced into the design.'));
    }
    for (const item of review.findings || []) {
      if (item?.severity === 'blocking' && item.resolved !== true) {
        findings.push(finding('unresolved-review-finding', item.message || 'A blocking walkthrough finding is unresolved.', { sourceId: item.id }));
      }
    }
  }

  const footprints = model.furniture.map(footprint);
  for (let index = 0; index < footprints.length; index += 1) {
    const current = footprints[index];
    const room = model.rooms.find((item) => item.id === current.item.roomId);
    if (room && !corners(current).every((point) => pointInPolygon(point, room.polygon))) {
      findings.push(finding('furniture-outside-room', `${current.item.name || current.item.id} extends outside ${room.name || room.id}.`, { furnitureIds: [current.item.id], roomId: room.id }));
    }
    for (let next = index + 1; next < footprints.length; next += 1) {
      const other = footprints[next];
      if (current.item.roomId === other.item.roomId && overlaps(current, other) && !collisionExempt(current.item) && !collisionExempt(other.item)) {
        findings.push(finding('furniture-overlap', `${current.item.name || current.item.id} overlaps ${other.item.name || other.item.id}.`, { furnitureIds: [current.item.id, other.item.id], roomId: current.item.roomId }));
      }
    }
  }

  for (const opening of model.openings.filter((item) => item.kind === 'door')) {
    const wall = model.walls.find((item) => item.id === opening.wallId);
    if (!wall) continue;
    const center = interpolate(wall.from, wall.to, opening.offset);
    const clearance = { minX: center[0] - 0.55, maxX: center[0] + 0.55, minZ: center[1] - 0.55, maxZ: center[1] + 0.55 };
    for (const item of footprints) {
      if (overlaps(clearance, item) && !collisionExempt(item.item)) {
        findings.push(finding('door-clearance-blocked', `${item.item.name || item.item.id} blocks the operating area of door ${opening.id}.`, { furnitureIds: [item.item.id], openingId: opening.id }));
      }
    }
  }

  return { ok: findings.length === 0, errors: [], findings, qualityReview: review || null };
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
function finding(code, message, context = {}) { return { severity: 'blocking', code, message, ...context }; }
function interpolate([ax, az], [bx, bz], amount) { return [ax + (bx - ax) * amount, az + (bz - az) * amount]; }
function footprint(item) {
  const angle = item.rotation * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * item.size[0] / 2 + Math.abs(Math.sin(angle)) * item.size[1] / 2;
  const halfZ = Math.abs(Math.sin(angle)) * item.size[0] / 2 + Math.abs(Math.cos(angle)) * item.size[1] / 2;
  return { item, minX: item.position[0] - halfX, maxX: item.position[0] + halfX, minZ: item.position[1] - halfZ, maxZ: item.position[1] + halfZ };
}
function corners(box) { return [[box.minX, box.minZ], [box.maxX, box.minZ], [box.maxX, box.maxZ], [box.minX, box.maxZ]]; }
function overlaps(a, b) { return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ; }
function collisionExempt(item) { return item.clearanceExempt === true || /rug|carpet|地毯/i.test(item.kind || ''); }
function pointInPolygon([x, z], polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index], [xj, zj] = polygon[previous];
    if (((zi > z) !== (zj > z)) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside || polygon.some(([px, pz]) => Math.abs(px - x) < 1e-9 && Math.abs(pz - z) < 1e-9);
}
