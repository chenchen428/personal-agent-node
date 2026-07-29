export function polygonArea(points) {
  return points.reduce((sum, [x, z], index) => {
    const [nextX, nextZ] = points[(index + 1) % points.length];
    return sum + x * nextZ - nextX * z;
  }, 0) / 2;
}

export function polygonCentroid(points) {
  const area = polygonArea(points);
  if (Math.abs(area) < 1e-9) {
    return points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  }
  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const factor = current[0] * next[1] - next[0] * current[1];
    x += (current[0] + next[0]) * factor;
    z += (current[1] + next[1]) * factor;
  }
  return [x / (6 * area), z / (6 * area)];
}

export function pointInPolygon([x, z], polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, zi] = polygon[index];
    const [xj, zj] = polygon[previous];
    if (((zi > z) !== (zj > z)) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside || polygon.some((point) => distance(point, [x, z]) < 1e-7);
}

export function polygonSelfIntersects(points) {
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first];
    const b = points[(first + 1) % points.length];
    for (let second = first + 1; second < points.length; second += 1) {
      if (Math.abs(first - second) <= 1 || (first === 0 && second === points.length - 1)) continue;
      const c = points[second];
      const d = points[(second + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

export function wallLength(wall) {
  return distance(wall.start, wall.end);
}

export function wallPoint(wall, amount) {
  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * amount,
    wall.start[1] + (wall.end[1] - wall.start[1]) * amount,
  ];
}

export function itemObb(item, expansion = 0) {
  const angle = (item.rotation || 0) * Math.PI / 180;
  return {
    id: item.itemId,
    center: item.position,
    half: [item.size[0] / 2 + expansion, item.size[1] / 2 + expansion],
    axes: [[Math.cos(angle), Math.sin(angle)], [-Math.sin(angle), Math.cos(angle)]],
  };
}

export function orientedBox(center, size, angleRadians = 0, id = null) {
  return {
    id,
    center,
    half: [size[0] / 2, size[1] / 2],
    axes: [[Math.cos(angleRadians), Math.sin(angleRadians)], [-Math.sin(angleRadians), Math.cos(angleRadians)]],
  };
}

export function obbCorners(box) {
  const [axisX, axisZ] = box.axes;
  const [halfX, halfZ] = box.half;
  return [
    add(box.center, add(scale(axisX, halfX), scale(axisZ, halfZ))),
    add(box.center, add(scale(axisX, halfX), scale(axisZ, -halfZ))),
    add(box.center, add(scale(axisX, -halfX), scale(axisZ, -halfZ))),
    add(box.center, add(scale(axisX, -halfX), scale(axisZ, halfZ))),
  ];
}

export function obbOverlaps(first, second) {
  const axes = [...first.axes, ...second.axes];
  return axes.every((axis) => {
    const firstProjection = project(first, axis);
    const secondProjection = project(second, axis);
    return firstProjection.min < secondProjection.max - 1e-7 && firstProjection.max > secondProjection.min + 1e-7;
  });
}

export function pointInObb(point, box) {
  const relative = subtract(point, box.center);
  return Math.abs(dot(relative, box.axes[0])) <= box.half[0] && Math.abs(dot(relative, box.axes[1])) <= box.half[1];
}

export function pointObbDistance(point, box) {
  const relative = subtract(point, box.center);
  const local = [dot(relative, box.axes[0]), dot(relative, box.axes[1])];
  const outside = [
    Math.max(Math.abs(local[0]) - box.half[0], 0),
    Math.max(Math.abs(local[1]) - box.half[1], 0),
  ];
  return Math.hypot(...outside);
}

export function segmentIntersectsObb(start, end, box) {
  const localStart = [
    dot(subtract(start, box.center), box.axes[0]),
    dot(subtract(start, box.center), box.axes[1]),
  ];
  const localEnd = [
    dot(subtract(end, box.center), box.axes[0]),
    dot(subtract(end, box.center), box.axes[1]),
  ];
  const direction = subtract(localEnd, localStart);
  let minimum = 0;
  let maximum = 1;
  for (let axis = 0; axis < 2; axis += 1) {
    const extent = box.half[axis];
    if (Math.abs(direction[axis]) < 1e-9) {
      if (localStart[axis] < -extent || localStart[axis] > extent) return false;
      continue;
    }
    const first = (-extent - localStart[axis]) / direction[axis];
    const second = (extent - localStart[axis]) / direction[axis];
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return true;
}

export function pointSegmentDistance(point, start, end) {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (!lengthSquared) return distance(point, start);
  const amount = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSquared));
  return distance(point, add(start, scale(segment, amount)));
}

export function openingClearanceBox(opening, wall) {
  const center = wallPoint(wall, opening.position);
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
  return orientedBox(center, [opening.width + 0.2, opening.type === 'door' ? 1.1 : 0.75], angle, opening.openingId);
}

export function roomBounds(rooms) {
  const points = rooms.flatMap((room) => room.polygon);
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function project(box, axis) {
  const center = dot(box.center, axis);
  const radius = box.half[0] * Math.abs(dot(box.axes[0], axis)) + box.half[1] * Math.abs(dot(box.axes[1], axis));
  return { min: center - radius, max: center + radius };
}

function segmentsIntersect(a, b, c, d) {
  const direction = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const first = direction(a, b, c);
  const second = direction(a, b, d);
  const third = direction(c, d, a);
  const fourth = direction(c, d, b);
  return first !== second && third !== fourth;
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function scale(value, amount) { return [value[0] * amount, value[1] * amount]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
