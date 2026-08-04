const EPSILON = 1e-6;

export function resolvePortalTopology(geometry = {}) {
  const walls = new Map((geometry.walls ?? []).map((wall) => [wall.id, wall]));
  const openings = new Map((geometry.openings ?? []).map((opening) => [opening.id, opening]));
  return (geometry.portals ?? []).map((portal) => {
    const opening = openings.get(portal.openingId);
    const wall = opening ? walls.get(opening.wallId) : null;
    if (!opening || !wall) return { ...portal, valid: false };
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const tangent = length > EPSILON
      ? [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length]
      : [1, 0];
    const midpoint = opening.offset + opening.width / 2;
    const threshold = [
      round(wall.start[0] + tangent[0] * midpoint),
      round(wall.start[1] + tangent[1] * midpoint),
      round((opening.sill ?? 0) + 40),
    ];
    return {
      ...portal,
      valid: true,
      wallId: wall.id,
      type: opening.type,
      width: opening.width,
      height: opening.height,
      threshold,
      center: [threshold[0], threshold[1], round((opening.sill ?? 0) + opening.height / 2)],
      tangent: tangent.map(round),
      normal: [-tangent[1], tangent[0]].map(round),
      wallRotationDeg: round(Math.atan2(tangent[1], tangent[0]) * 180 / Math.PI),
    };
  });
}

export function resolveTourNodes(geometry = {}) {
  const nodes = geometry.panoramaNodes ?? [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portalById = new Map(resolvePortalTopology(geometry).map((portal) => [portal.id, portal]));
  return nodes.map((node) => ({
    ...node,
    hotspots: (node.hotspots ?? []).map((hotspot, index) => {
      const target = nodeById.get(hotspot.target);
      const portal = hotspot.kind === "portal" ? portalById.get(hotspot.portalId) : null;
      const anchor = portal?.threshold ?? hotspot.anchor;
      if (!target || !validPoint3(anchor)) {
        return { ...hotspot, id: hotspot.id ?? `hotspot-${index + 1}`, valid: false };
      }
      const travelVector = [anchor[0] - node.position[0], anchor[1] - node.position[1]];
      const targetSide = [target.position[0] - anchor[0], target.position[1] - anchor[1]];
      const declaredArrival = validPoint3(hotspot.arrivalLookAt)
        ? [hotspot.arrivalLookAt[0] - target.position[0], hotspot.arrivalLookAt[1] - target.position[1]]
        : null;
      const portalDirection = declaredArrival ?? (portal
        ? orientToward(portal.normal, targetSide)
        : null);
      const destinationVector = portalDirection ?? travelVector;
      return {
        ...hotspot,
        id: hotspot.id ?? `hotspot-${index + 1}`,
        valid: true,
        kind: hotspot.kind ?? "waypoint",
        label: hotspot.label ?? target.title ?? target.id,
        anchor,
        anchorType: portal ? "door-threshold" : "floor-waypoint",
        departureYaw: localYaw(node, travelVector),
        departurePitch: verticalAngle(node.position, anchor),
        arrivalYaw: localYaw(target, destinationVector),
        arrivalPitch: Number(target.initialView?.pitch ?? 0),
        portal: portal ? {
          id: portal.id,
          openingId: portal.openingId,
          center: portal.center,
          threshold: portal.threshold,
          width: portal.width,
          height: portal.height,
          normal: portal.normal,
          state: portal.state,
        } : null,
      };
    }),
  }));
}

export function auditPortalTopology(geometry = {}) {
  const issues = [];
  const rooms = new Set((geometry.rooms ?? []).map((room) => room.id));
  const openings = new Map((geometry.openings ?? []).map((opening) => [opening.id, opening]));
  const nodes = new Map((geometry.panoramaNodes ?? []).map((node) => [node.id, node]));
  const portals = new Map(resolvePortalTopology(geometry).map((portal) => [portal.id, portal]));

  for (const portal of portals.values()) {
    const opening = openings.get(portal.openingId);
    if (!portal.valid) issues.push(issue("error", "GEO-PORTAL-OPENING", portal.id, "Portal must reference an existing opening and wall."));
    if (opening && !["door", "passage"].includes(opening.type)) issues.push(issue("error", "GEO-PORTAL-TYPE", portal.id, "Only door or passage openings can be traversable portals."));
    if (!Array.isArray(portal.roomIds) || portal.roomIds.length !== 2 || portal.roomIds.some((id) => !rooms.has(id))) {
      issues.push(issue("error", "GEO-PORTAL-ROOMS", portal.id, "Portal must connect exactly two existing rooms."));
    }
    if (portal.traversable !== true || portal.state !== "open") {
      issues.push(issue("error", "GEO-PORTAL-STATE", portal.id, "Tour portals must be explicitly traversable and open."));
    }
  }

  const resolved = resolveTourNodes(geometry);
  for (const node of resolved) {
    for (const hotspot of node.hotspots ?? []) {
      if (!nodes.has(hotspot.target)) issues.push(issue("error", "GEO-HOTSPOT-TARGET", node.id, `Unknown target: ${hotspot.target}`));
      if (!hotspot.valid) issues.push(issue("error", "GEO-HOTSPOT-ANCHOR", node.id, `Hotspot ${hotspot.id} has no valid floor anchor.`));
      if (hotspot.kind === "portal") {
        const portal = portals.get(hotspot.portalId);
        const target = nodes.get(hotspot.target);
        if (!portal) issues.push(issue("error", "GEO-HOTSPOT-PORTAL", node.id, `Unknown portal: ${hotspot.portalId}`));
        if (portal && target && (!portal.roomIds.includes(node.roomId) || !portal.roomIds.includes(target.roomId))) {
          issues.push(issue("error", "GEO-HOTSPOT-PORTAL-ROOM", node.id, `Portal ${portal.id} does not connect the source and target rooms.`));
        }
      }
    }
  }

  for (const node of resolved) {
    for (const hotspot of node.hotspots ?? []) {
      if (hotspot.kind !== "portal" || !hotspot.valid) continue;
      const reverse = resolved.find((entry) => entry.id === hotspot.target)?.hotspots?.find((entry) => entry.target === node.id && entry.portalId === hotspot.portalId);
      if (!reverse) issues.push(issue("error", "GEO-HOTSPOT-RETURN", node.id, `Portal ${hotspot.portalId} must provide a return hotspot.`));
    }
  }
  return issues;
}

function localYaw(node, worldVector) {
  const forward = [node.lookAt[0] - node.position[0], node.lookAt[1] - node.position[1]];
  const forwardLength = Math.hypot(...forward);
  const vectorLength = Math.hypot(...worldVector);
  if (forwardLength < EPSILON || vectorLength < EPSILON) return 0;
  const fx = forward[0] / forwardLength;
  const fy = forward[1] / forwardLength;
  const tx = worldVector[0] / vectorLength;
  const ty = worldVector[1] / vectorLength;
  return yaw(Math.atan2(fx * ty - fy * tx, fx * tx + fy * ty) * 180 / Math.PI);
}

function verticalAngle(position, anchor) {
  const horizontal = Math.hypot(anchor[0] - position[0], anchor[1] - position[1]);
  return round(Math.atan2(position[2] - anchor[2], Math.max(1, horizontal)) * 180 / Math.PI);
}

function orientToward(direction, targetVector) {
  const sign = direction[0] * targetVector[0] + direction[1] * targetVector[1] >= 0 ? 1 : -1;
  return [direction[0] * sign, direction[1] * sign];
}

function validPoint3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function issue(level, code, ref, message) {
  return { level, code, refs: [ref], message };
}

function yaw(value) {
  return round((((value + 180) % 360) + 360) % 360 - 180);
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
