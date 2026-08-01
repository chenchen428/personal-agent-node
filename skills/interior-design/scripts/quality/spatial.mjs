import {
  distance,
  itemObb,
  obbCorners,
  obbOverlaps,
  openingClearanceBox,
  pointInObb,
  pointInPolygon,
  pointObbDistance,
  pointSegmentDistance,
  polygonArea,
  polygonCentroid,
  polygonSelfIntersects,
  roomBounds,
  segmentIntersectsObb,
  wallLength,
  wallPoint,
} from './geometry.mjs';
import { issue } from './issues.mjs';

const GRID = 0.25;
const MINIMUM_PASSAGE_WIDTH = 0.75;
const MAXIMUM_WALKABLE_EDGES = 20_000;

export function auditSpatial(project, concept) {
  const findings = [];
  for (const level of concept.levels) {
    findings.push(...auditLevelGeometry(project, level));
    findings.push(...auditFurniture(project, level));
    findings.push(...auditOpenings(project, level));
    findings.push(...auditCirculation(project, level, concept));
  }
  findings.push(...auditMultiLevel(project, concept));
  return findings;
}

function auditLevelGeometry(project, level) {
  const findings = [];
  if (polygonSelfIntersects(level.footprint) || Math.abs(polygonArea(level.footprint)) < 0.5) {
    findings.push(issue(project, 'geometry.level-footprint', 'blocking', `Level ${level.name} has an invalid footprint.`, {
      levelIds: [level.levelId],
      measurement: { areaM2: Math.abs(polygonArea(level.footprint)) },
      threshold: { minimumAreaM2: 0.5 },
      fix: 'Repair the footprint so it is a simple, non-degenerate polygon.',
    }));
  }
  for (const room of level.rooms) {
    const area = Math.abs(polygonArea(room.polygon));
    if (polygonSelfIntersects(room.polygon) || area < 0.5) {
      findings.push(issue(project, 'geometry.room-polygon', 'blocking', `Room ${room.name} has an invalid polygon.`, {
        nodeIds: [room.roomId],
        levelIds: [level.levelId],
        measurement: { areaM2: area },
        threshold: { minimumAreaM2: 0.5 },
        fix: 'Repair the room boundary before publishing the plan.',
      }));
    }
  }
  for (const wall of level.walls) {
    const length = wallLength(wall);
    if (length < 0.1) {
      findings.push(issue(project, 'geometry.wall-degenerate', 'blocking', `Wall ${wall.wallId} is too short to model safely.`, {
        nodeIds: [wall.wallId],
        levelIds: [level.levelId],
        measurement: { lengthMetres: length },
        threshold: { minimumLengthMetres: 0.1 },
        fix: 'Remove the wall or provide distinct endpoints.',
      }));
    }
    if (Number.isInteger(wall.exteriorEdge) && wall.exteriorEdge >= 0) {
      const start = level.footprint[wall.exteriorEdge];
      const end = level.footprint[(wall.exteriorEdge + 1) % level.footprint.length];
      const forward = start && end && Math.hypot(wall.start[0] - start[0], wall.start[1] - start[1]) < 0.02
        && Math.hypot(wall.end[0] - end[0], wall.end[1] - end[1]) < 0.02;
      const reverse = start && end && Math.hypot(wall.start[0] - end[0], wall.start[1] - end[1]) < 0.02
        && Math.hypot(wall.end[0] - start[0], wall.end[1] - start[1]) < 0.02;
      if (!forward && !reverse) {
        findings.push(issue(project, 'topology.wall-footprint-mismatch', 'blocking', `Wall ${wall.wallId} does not match its declared exterior footprint edge.`, {
          nodeIds: [wall.wallId],
          levelIds: [level.levelId],
          measurement: { exteriorEdge: wall.exteriorEdge, endpointToleranceMetres: 0.02 },
          threshold: { maximumEndpointGapMetres: 0.02 },
          thresholdSource: 'product-concept-default',
          fix: 'Correct the wall endpoints or remove the exteriorEdge mapping before scene compilation.',
        }));
      }
    }
  }
  return findings;
}

function auditFurniture(project, level) {
  const findings = [];
  const boxes = level.items.map((item) => ({ item, box: itemObb(item) }));
  for (let index = 0; index < boxes.length; index += 1) {
    const current = boxes[index];
    const room = level.rooms.find((entry) => entry.roomId === current.item.roomId);
    if (room && !obbCorners(current.box).every((point) => pointInPolygon(point, room.polygon))) {
      findings.push(issue(project, 'spatial.item-outside-room', 'blocking', `${current.item.name} extends outside ${room.name}.`, {
        nodeIds: [current.item.itemId, room.roomId],
        levelIds: [level.levelId],
        fix: 'Move or resize the item so its rotated footprint remains inside the assigned room.',
      }));
    }
    for (let next = index + 1; next < boxes.length; next += 1) {
      const other = boxes[next];
      if (current.item.clearanceExempt || other.item.clearanceExempt) continue;
      if (obbOverlaps(current.box, other.box)) {
        findings.push(issue(project, 'spatial.item-collision', 'blocking', `${current.item.name} collides with ${other.item.name}.`, {
          nodeIds: [current.item.itemId, other.item.itemId],
          levelIds: [level.levelId],
          fix: 'Move, rotate, resize, or remove one of the colliding items.',
        }));
      }
      const expansion = operatingClearance(current.item);
      if (expansion > 0 && obbOverlaps(itemObb(current.item, expansion), other.box)) {
        findings.push(issue(project, 'spatial.operating-clearance', 'blocking', `${other.item.name} blocks the operating or maintenance clearance of ${current.item.name}.`, {
          nodeIds: [current.item.itemId, other.item.itemId],
          levelIds: [level.levelId],
          measurement: { clearanceMetres: expansion },
          threshold: { minimumClearanceMetres: expansion },
          thresholdSource: current.item.assetProfile ? 'asset-profile' : 'product-concept-default',
          fix: 'Separate the items so cabinet doors, drawers, appliances, or required maintenance faces can operate.',
        }));
      }
    }
    if (room && !current.item.clearanceExempt) {
      const expansion = operatingClearance(current.item);
      if (expansion > 0 && !obbCorners(itemObb(current.item, expansion)).every((point) => pointInPolygon(point, room.polygon))) {
        findings.push(issue(project, 'spatial.use-clearance', 'blocking', `${current.item.name} lacks its conceptual use clearance.`, {
          nodeIds: [current.item.itemId, room.roomId],
          levelIds: [level.levelId],
          measurement: { clearanceMetres: expansion },
          threshold: { minimumClearanceMetres: expansion },
          thresholdSource: current.item.assetProfile ? 'asset-profile' : 'product-concept-default',
          fix: 'Move or resize the item, or record a project-specific clearance requirement.',
        }));
      }
    }
    for (const wall of level.walls) {
      if (segmentIntersectsObb(wall.start, wall.end, itemObb(current.item, wall.thickness / 2))) {
        const openingOnWall = level.openings.some((opening) => {
          if (opening.wallId !== wall.wallId) return false;
          const center = wallPoint(wall, opening.position);
          return pointInObb(center, current.box) && opening.width >= Math.min(current.item.size[0], current.item.size[1]);
        });
        if (!openingOnWall) {
          findings.push(issue(project, 'spatial.item-wall-intersection', 'blocking', `${current.item.name} intersects wall ${wall.wallId}.`, {
            nodeIds: [current.item.itemId, wall.wallId],
            levelIds: [level.levelId],
            measurement: { wallThicknessMetres: wall.thickness },
            threshold: { intersectionAllowed: false },
            thresholdSource: 'product-concept-default',
            fix: 'Move or resize the item so it does not pass through a wall.',
          }));
        }
      }
    }
  }
  return findings;
}

function auditOpenings(project, level) {
  const findings = [];
  const boxes = level.items.filter((item) => !item.clearanceExempt).map((item) => ({ item, box: itemObb(item) }));
  for (const opening of level.openings) {
    const wall = level.walls.find((entry) => entry.wallId === opening.wallId);
    if (!wall) continue;
    const length = wallLength(wall);
    const center = opening.position * length;
    const edgeClearance = Math.min(center - opening.width / 2, length - center - opening.width / 2);
    if (edgeClearance < 0.05) {
      findings.push(issue(project, 'topology.opening-outside-wall', 'blocking', `Opening ${opening.openingId} does not fit within its wall.`, {
        nodeIds: [opening.openingId, wall.wallId],
        levelIds: [level.levelId],
        measurement: { edgeClearanceMetres: edgeClearance, wallLengthMetres: length, openingWidthMetres: opening.width },
        threshold: { minimumEdgeClearanceMetres: 0.05 },
        fix: 'Move or resize the opening so the full cutout stays inside the wall.',
      }));
    }
    const firstStart = center - opening.width / 2;
    const firstEnd = center + opening.width / 2;
    for (const other of level.openings) {
      if (opening.openingId >= other.openingId || opening.wallId !== other.wallId) continue;
      const otherCenter = other.position * length;
      const overlap = Math.min(firstEnd, otherCenter + other.width / 2) - Math.max(firstStart, otherCenter - other.width / 2);
      if (overlap > -0.05) {
        findings.push(issue(project, 'topology.opening-conflict', 'blocking', `Openings ${opening.openingId} and ${other.openingId} overlap or lack wall separation.`, {
          nodeIds: [opening.openingId, other.openingId, wall.wallId],
          levelIds: [level.levelId],
          measurement: { overlapMetres: Math.max(0, overlap), separationMetres: Math.max(0, -overlap) },
          threshold: { minimumSeparationMetres: 0.05 },
          thresholdSource: 'product-concept-default',
          fix: 'Move or resize the openings so their cutouts retain a valid wall segment.',
        }));
      }
    }
    const clearance = openingClearanceBox(opening, wall);
    for (const entry of boxes) {
      if (obbOverlaps(clearance, entry.box)) {
        findings.push(issue(project, opening.type === 'door' ? 'spatial.door-clearance' : 'spatial.window-clearance', 'blocking', `${entry.item.name} blocks the operating area of ${opening.openingId}.`, {
          nodeIds: [opening.openingId, entry.item.itemId],
          levelIds: [level.levelId],
          measurement: { clearanceDepthMetres: opening.type === 'door' ? 1.1 : 0.75 },
          threshold: { minimumClearanceDepthMetres: opening.type === 'door' ? 1.1 : 0.75 },
          fix: 'Move the item away from the opening swing, access, or maintenance area.',
        }));
      }
    }
  }
  return findings;
}

function auditCirculation(project, level, concept) {
  const passagePolicy = project.brief?.qualityThresholds?.minimumPassageWidthMetres;
  const minimumPassageWidth = Number.isFinite(passagePolicy?.value) ? passagePolicy.value : MINIMUM_PASSAGE_WIDTH;
  const passageThresholdSource = passagePolicy?.source || 'product-concept-default';
  const requiredRooms = level.rooms.filter((room) => room.requiredAccess !== false);
  const incomingStairs = concept.levels.flatMap((sourceLevel) => sourceLevel.stairs
    .filter((stair) => stair.toLevelId === level.levelId)
    .map((stair) => ({ stair, sourceLevelId: sourceLevel.levelId })));
  const outgoingStairs = level.stairs;
  if (!requiredRooms.length && !incomingStairs.length && !outgoingStairs.length) return [];
  const bounds = roomBounds(level.rooms);
  const circulationItems = level.items.filter((item) => !item.clearanceExempt).map((item) => itemObb(item));
  const blockedItems = circulationItems.map((box) => ({ ...box, half: box.half.map((value) => value + 0.1) }));
  const walkable = new Map();
  const localWidths = new Map();
  const xCount = Math.ceil((bounds.maxX - bounds.minX) / GRID) + 1;
  const zCount = Math.ceil((bounds.maxZ - bounds.minZ) / GRID) + 1;
  if (xCount * zCount > 200_000) {
    return [issue(project, 'circulation.grid-capacity', 'blocking', `Level ${level.name} exceeds the circulation grid capacity.`, {
      levelIds: [level.levelId],
      measurement: { cells: xCount * zCount },
      threshold: { maximumCells: 200000 },
      fix: 'Split the level into bounded design zones or correct an unrealistic footprint.',
    })];
  }
  for (let xIndex = 0; xIndex < xCount; xIndex += 1) {
    for (let zIndex = 0; zIndex < zCount; zIndex += 1) {
      const point = [bounds.minX + xIndex * GRID, bounds.minZ + zIndex * GRID];
      if (!level.rooms.some((room) => pointInPolygon(point, room.polygon))) continue;
      if (blockedItems.some((box) => pointInObb(point, box))) continue;
      if (blockedByWall(point, level)) continue;
      const key = `${xIndex}:${zIndex}`;
      walkable.set(key, point);
      localWidths.set(key, circulationWidth(point, level, circulationItems));
    }
  }
  const anchors = requiredRooms.map((room) => ({ room, key: nearestWalkable(polygonCentroid(room.polygon), walkable) }));
  const stairAnchors = outgoingStairs.map((stair) => ({ stair, key: nearestWalkable(stair.position, walkable) }));
  const explicitEntry = level.openings.find((opening) => opening.type === 'door' && opening.isEntry);
  const entryOpening = explicitEntry || (!incomingStairs.length
    ? level.openings.find((opening) => opening.type === 'door' && (opening.connectsRoomIds || []).length <= 1)
    : null);
  const entryWall = entryOpening && level.walls.find((wall) => wall.wallId === entryOpening.wallId);
  const startPoint = incomingStairs[0]?.stair.position
    || (entryWall ? wallPoint(entryWall, entryOpening.position) : polygonCentroid(requiredRooms[0]?.polygon || level.footprint));
  const start = nearestWalkable(startPoint, walkable);
  if (!start) {
    return [issue(project, 'circulation.entry-blocked', 'blocking', `No walkable entry point exists on ${level.name}.`, {
      levelIds: [level.levelId],
      nodeIds: entryOpening ? [entryOpening.openingId] : incomingStairs.map(({ stair }) => stair.stairId),
      fix: 'Clear the entry and provide a continuous walkable area.',
    })];
  }
  const reached = flood(start, walkable);
  const widest = widestPaths(start, walkable, localWidths);
  const walkableEdges = countWalkableEdges(walkable);
  const findings = [];
  if (walkableEdges > MAXIMUM_WALKABLE_EDGES) {
    findings.push(issue(project, 'circulation.edge-capacity', 'blocking', `Level ${level.name} exceeds the supported circulation graph capacity.`, {
      levelIds: [level.levelId],
      measurement: { walkableCells: walkable.size, walkableEdges, gridMetres: GRID },
      threshold: { maximumWalkableEdges: MAXIMUM_WALKABLE_EDGES },
      thresholdSource: 'product-concept-default',
      fix: 'Split the design into bounded zones or correct an unrealistic footprint before path analysis.',
    }));
  }
  const passageResults = [];
  for (const anchor of anchors) {
    if (!anchor.key || !reached.has(anchor.key)) {
      findings.push(issue(project, 'circulation.room-unreachable', 'blocking', `${anchor.room.name} is not reachable from the level entry.`, {
        nodeIds: [anchor.room.roomId],
        levelIds: [level.levelId],
        measurement: { gridMetres: GRID },
        threshold: { requiredReachable: true },
        fix: 'Open a valid door path and remove furniture or wall obstructions.',
      }));
      continue;
    }
    const passage = bestPassageForRoom(anchor.room, walkable, widest);
    if (passage) passageResults.push({ room: anchor.room, ...passage });
    if (passage && passage.width + 1e-6 < minimumPassageWidth) {
      findings.push(issue(project, 'circulation.minimum-width', 'blocking', `${anchor.room.name} is reachable only through a passage narrower than the concept minimum.`, {
        nodeIds: [anchor.room.roomId],
        levelIds: [level.levelId],
        measurement: {
          minimumWidthMetres: roundMetres(passage.width),
          location: walkable.get(passage.bottleneckKey).map(roundMetres),
          gridMetres: GRID,
        },
        threshold: { minimumPassageWidthMetres: minimumPassageWidth },
        thresholdSource: passageThresholdSource,
        fix: 'Widen the door or passage, or move fixed elements and furniture to preserve a usable route.',
      }));
    }
  }
  for (const anchor of stairAnchors) {
    if (!anchor.key || !reached.has(anchor.key)) {
      findings.push(issue(project, 'circulation.stair-unreachable', 'blocking', `Stair ${anchor.stair.stairId} is not reachable from the level entry.`, {
        nodeIds: [anchor.stair.stairId],
        levelIds: [level.levelId, anchor.stair.toLevelId],
        measurement: { gridMetres: GRID },
        threshold: { requiredReachable: true },
        fix: 'Clear a continuous route from the level entry to the stair landing.',
      }));
      continue;
    }
    const passage = widest.get(anchor.key);
    if (passage) passageResults.push({ room: { roomId: anchor.stair.stairId }, ...passage });
    if (passage && passage.width + 1e-6 < minimumPassageWidth) {
      findings.push(issue(project, 'circulation.minimum-width', 'blocking', `Stair ${anchor.stair.stairId} is reachable only through a passage narrower than the concept minimum.`, {
        nodeIds: [anchor.stair.stairId],
        levelIds: [level.levelId, anchor.stair.toLevelId],
        measurement: {
          minimumWidthMetres: roundMetres(passage.width),
          location: walkable.get(passage.bottleneckKey).map(roundMetres),
          gridMetres: GRID,
        },
        threshold: { minimumPassageWidthMetres: minimumPassageWidth },
        thresholdSource: passageThresholdSource,
        fix: 'Widen the route to the stair or move fixed elements and furniture.',
      }));
    }
  }
  if (passageResults.length) {
    const narrowest = passageResults.reduce((current, candidate) => candidate.width < current.width ? candidate : current);
    findings.push(issue(project, 'circulation.narrowest-passage', 'info', `The narrowest modeled route on ${level.name} is reported for design review.`, {
      nodeIds: [narrowest.room.roomId],
      levelIds: [level.levelId],
      measurement: {
        minimumWidthMetres: roundMetres(narrowest.width),
        location: walkable.get(narrowest.bottleneckKey).map(roundMetres),
        gridMetres: GRID,
        walkableCells: walkable.size,
        walkableEdges,
      },
      threshold: { comfortReviewWidthMetres: minimumPassageWidth },
      thresholdSource: passageThresholdSource,
      fix: 'Keep this bottleneck visible and replace the product default if the user or jurisdiction supplies another threshold.',
    }));
  }
  return findings;
}

function auditMultiLevel(project, concept) {
  if (concept.levels.length < 2) return [];
  const findings = [];
  const ordered = [...concept.levels].sort((a, b) => a.elevation - b.elevation);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const level = ordered[index];
    const target = ordered[index + 1];
    const stair = level.stairs.find((entry) => entry.toLevelId === target.levelId);
    if (!stair) {
      findings.push(issue(project, 'multilevel.stair-missing', 'blocking', `${level.name} does not connect to ${target.name}.`, {
        levelIds: [level.levelId, target.levelId],
        fix: 'Add a stair and matching slab/ceiling opening between adjacent occupied levels.',
      }));
      continue;
    }
    if (stair.width < 0.8 || (stair.headroom ?? 2) < 2) {
      findings.push(issue(project, 'multilevel.stair-clearance', 'blocking', `Stair ${stair.stairId} has insufficient conceptual width or headroom.`, {
        nodeIds: [stair.stairId],
        levelIds: [level.levelId, target.levelId],
        measurement: { widthMetres: stair.width, headroomMetres: stair.headroom ?? 2 },
        threshold: { minimumWidthMetres: 0.8, minimumHeadroomMetres: 2 },
        thresholdSource: 'product-concept-default',
        fix: 'Revise the stair geometry and obtain local code and structural verification.',
        professionalVerification: true,
      }));
    }
    const expectedRise = target.elevation - level.elevation;
    if (Math.abs(stair.totalRise - expectedRise) > 0.1) {
      findings.push(issue(project, 'multilevel.stair-rise-mismatch', 'blocking', `Stair ${stair.stairId} rise does not match the connected level elevations.`, {
        nodeIds: [stair.stairId],
        levelIds: [level.levelId, target.levelId],
        measurement: { stairRiseMetres: stair.totalRise, levelRiseMetres: expectedRise, differenceMetres: Math.abs(stair.totalRise - expectedRise) },
        threshold: { maximumDifferenceMetres: 0.1 },
        thresholdSource: 'product-concept-default',
        fix: 'Correct the stair rise or level elevations and verify the stair structure and local requirements.',
        professionalVerification: true,
      }));
    }
    if (!level.voids.length) {
      findings.push(issue(project, 'multilevel.stair-void-missing', 'blocking', `Stair ${stair.stairId} has no explicit slab or ceiling void in the project model.`, {
        nodeIds: [stair.stairId],
        levelIds: [level.levelId, target.levelId],
        measurement: { matchingVoids: 0 },
        threshold: { minimumMatchingVoids: 1 },
        thresholdSource: 'product-concept-default',
        fix: 'Record the stair opening as a governed void and verify its structure and guard protection.',
        professionalVerification: true,
      }));
    }
  }
  for (const level of concept.levels) {
    for (const voidArea of level.voids) {
      const protectedBy = level.guardrails.filter((guardrail) => guardrail.voidId === voidArea.voidId);
      if (!protectedBy.length) {
        findings.push(issue(project, 'multilevel.void-unguarded', 'blocking', `Void ${voidArea.voidId} has no recorded guardrail.`, {
          nodeIds: [voidArea.voidId],
          levelIds: [level.levelId],
          fix: 'Add a continuous guardrail and obtain code and structural verification.',
          professionalVerification: true,
        }));
      } else {
        const perimeter = voidArea.polygon.reduce((sum, point, index) => sum + distance(point, voidArea.polygon[(index + 1) % voidArea.polygon.length]), 0);
        const guardedLength = protectedBy.reduce((sum, guardrail) => sum + distance(guardrail.start, guardrail.end), 0);
        const minimumLength = perimeter * 0.75;
        if (guardedLength < minimumLength || protectedBy.some((guardrail) => (guardrail.height || 1.05) < 1)) {
          findings.push(issue(project, 'multilevel.guardrail-incomplete', 'blocking', `Void ${voidArea.voidId} does not have continuous conceptual guard protection.`, {
            nodeIds: [voidArea.voidId, ...protectedBy.map((entry) => entry.guardrailId)],
            levelIds: [level.levelId],
            measurement: { perimeterMetres: perimeter, guardedLengthMetres: guardedLength, minimumHeightMetres: Math.min(...protectedBy.map((entry) => entry.height || 1.05)) },
            threshold: { minimumGuardedLengthMetres: minimumLength, minimumHeightMetres: 1 },
            thresholdSource: 'product-concept-default',
            fix: 'Extend the guardrail around the void and obtain local code and structural verification.',
            professionalVerification: true,
          }));
        }
      }
    }
  }
  return findings;
}

function blockedByWall(point, level) {
  for (const wall of level.walls) {
    const distance = pointSegmentDistance(point, wall.start, wall.end);
    if (distance > wall.thickness / 2 + GRID * 0.35) continue;
    const opening = level.openings.find((entry) => {
      if (entry.type !== 'door' || entry.wallId !== wall.wallId) return false;
      const center = wallPoint(wall, entry.position);
      return Math.hypot(point[0] - center[0], point[1] - center[1]) <= entry.width / 2 + GRID;
    });
    if (!opening) return true;
  }
  return false;
}

function circulationWidth(point, level, itemBoxes) {
  let radius = Infinity;
  for (const box of itemBoxes) radius = Math.min(radius, pointObbDistance(point, box));
  for (const wall of level.walls) {
    const length = wallLength(wall);
    if (length <= 1e-9) continue;
    const along = projectionDistance(point, wall);
    const perpendicular = pointSegmentDistance(point, wall.start, wall.end);
    const door = level.openings.find((opening) => {
      if (opening.type !== 'door' || opening.wallId !== wall.wallId) return false;
      const center = opening.position * length;
      return along >= center - opening.width / 2 && along <= center + opening.width / 2
        && perpendicular <= wall.thickness / 2 + Math.min(opening.width / 2, MINIMUM_PASSAGE_WIDTH);
    });
    if (door) {
      radius = Math.min(radius, door.width / 2);
      continue;
    }
    radius = Math.min(radius, Math.max(0, perpendicular - wall.thickness / 2));
  }
  if (!Number.isFinite(radius)) return MINIMUM_PASSAGE_WIDTH * 4;
  return Math.max(GRID, radius * 2);
}

function projectionDistance(point, wall) {
  const vector = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
  const length = Math.hypot(...vector);
  if (length <= 1e-9) return 0;
  return Math.max(0, Math.min(length, ((point[0] - wall.start[0]) * vector[0] + (point[1] - wall.start[1]) * vector[1]) / length));
}

function widestPaths(start, walkable, localWidths) {
  const results = new Map();
  const pending = new MaxHeap();
  const startWidth = localWidths.get(start) || GRID;
  results.set(start, { width: startWidth, bottleneckKey: start });
  pending.push({ key: start, width: startWidth });
  while (pending.size) {
    const current = pending.pop();
    const recorded = results.get(current.key);
    if (!recorded || current.width + 1e-9 < recorded.width) continue;
    const [x, z] = current.key.split(':').map(Number);
    for (const key of [`${x + 1}:${z}`, `${x - 1}:${z}`, `${x}:${z + 1}`, `${x}:${z - 1}`]) {
      if (!walkable.has(key)) continue;
      const localWidth = localWidths.get(key) || GRID;
      const width = Math.min(current.width, localWidth);
      if (width <= (results.get(key)?.width || -Infinity) + 1e-9) continue;
      const bottleneckKey = localWidth < current.width ? key : recorded.bottleneckKey;
      results.set(key, { width, bottleneckKey });
      pending.push({ key, width });
    }
  }
  return results;
}

function countWalkableEdges(walkable) {
  let edges = 0;
  for (const key of walkable.keys()) {
    const [x, z] = key.split(':').map(Number);
    if (walkable.has(`${x + 1}:${z}`)) edges += 1;
    if (walkable.has(`${x}:${z + 1}`)) edges += 1;
  }
  return edges;
}

function bestPassageForRoom(room, walkable, widest) {
  let best = null;
  for (const [key, point] of walkable) {
    if (!pointInPolygon(point, room.polygon)) continue;
    const passage = widest.get(key);
    if (passage && (!best || passage.width > best.width)) best = passage;
  }
  return best;
}

class MaxHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  push(value) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].width >= value.width) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop() {
    const top = this.values[0];
    const tail = this.values.pop();
    if (!this.values.length) return top;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].width > this.values[left].width ? right : left;
      if (this.values[child].width <= tail.width) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = tail;
    return top;
  }
}

function roundMetres(value) {
  return Math.round(value * 1000) / 1000;
}

function nearestWalkable(point, walkable) {
  let best = null;
  let bestDistance = Infinity;
  for (const [key, candidate] of walkable) {
    const distance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return bestDistance <= 2 ? best : null;
}

function flood(start, walkable) {
  const queue = [start];
  const visited = new Set([start]);
  while (queue.length) {
    const current = queue.shift();
    const [x, z] = current.split(':').map(Number);
    for (const key of [`${x + 1}:${z}`, `${x - 1}:${z}`, `${x}:${z + 1}`, `${x}:${z - 1}`]) {
      if (!walkable.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(key);
    }
  }
  return visited;
}

function useClearance(kind = '') {
  if (/bed|床/i.test(kind)) return 0.45;
  if (/dining|table|餐桌/i.test(kind)) return 0.55;
  if (/toilet|wash|sink|卫浴|马桶/i.test(kind)) return 0.45;
  if (/cabinet|fridge|appliance|柜|冰箱/i.test(kind)) return 0.35;
  return 0;
}

function operatingClearance(item) {
  const envelope = item.assetProfile?.operatingClearance;
  if (!envelope) return useClearance(item.kind);
  return Math.max(0, ...['front', 'back', 'left', 'right'].map((key) => Number(envelope[key]) || 0));
}
