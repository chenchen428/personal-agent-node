import React, { useEffect, useMemo } from 'react';
import { DoubleSide, Shape } from 'three';

const EPSILON = 0.001;
const FLOOR_COLORS = Object.freeze({
  balcony: '#c9b997',
  bathroom: '#a9b1ad',
  bedroom: '#d7c9b5',
  dining: '#cdbb9f',
  foyer: '#c5b59d',
  kitchen: '#aeb5b0',
  laundry: '#adb5b0',
  living: '#c9bca8',
  'living-extension': '#d5c6ad',
  master: '#d7c9b5',
  study: '#c4cdbf',
  'family-work': '#c4cdbf',
});

export function ArchitectureEnvelope({ payload }) {
  const architecture = useMemo(
    () => buildArchitecture(payload.scene?.nodes || {}),
    [payload],
  );
  useEffect(() => {
    document.body.dataset.architectureRooms = String(architecture.rooms.length);
    document.body.dataset.architectureWallPieces = String(architecture.wallPieces.length);
    document.body.dataset.architectureRailings = String(architecture.railings.length);
    return () => {
      delete document.body.dataset.architectureRooms;
      delete document.body.dataset.architectureWallPieces;
      delete document.body.dataset.architectureRailings;
    };
  }, [architecture]);
  return <group name="personal-agent-architecture-envelope">
    <BoxShell
      color="#d5d9d5"
      position={[architecture.center[0], -0.06, architecture.center[1]]}
      size={[architecture.size[0] + 5.4, 0.12, architecture.size[1] + 5.4]}
    />
    {architecture.rooms.map((room) => <RoomSurface key={room.id} room={room} />)}
    {architecture.wallPieces.map((piece) => <BoxShell
      color={piece.exterior ? '#f4f2eb' : '#ebe8df'}
      key={piece.id}
      position={piece.position}
      rotation={[0, piece.rotation, 0]}
      size={piece.size}
    />)}
    {architecture.railings.map((railing) => <BalconyRailing key={railing.id} railing={railing} />)}
  </group>;
}

function RoomSurface({ room }) {
  const shape = useMemo(() => {
    const next = new Shape();
    room.polygon.forEach(([x, z], index) => {
      if (index === 0) next.moveTo(x, -z);
      else next.lineTo(x, -z);
    });
    next.closePath();
    return next;
  }, [room]);
  return <mesh
    name={`pascal-room-surface:${room.id}`}
    position={[0, 0.112, 0]}
    receiveShadow
    rotation={[-Math.PI / 2, 0, 0]}
  >
    <shapeGeometry args={[shape]} />
    <meshStandardMaterial
      color={FLOOR_COLORS[room.kind] || '#cbc3b5'}
      metalness={0}
      roughness={0.9}
      side={DoubleSide}
    />
  </mesh>;
}

function BoxShell({ color, position, rotation = [0, 0, 0], size }) {
  return <mesh castShadow position={position} receiveShadow rotation={rotation}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} metalness={0} roughness={0.82} />
  </mesh>;
}

function BalconyRailing({ railing }) {
  const postCount = Math.max(3, Math.ceil(railing.length / 1.15));
  return <group position={railing.position} rotation={[0, railing.rotation, 0]}>
    <mesh position={[0, 0.67, 0]}>
      <boxGeometry args={[railing.length, 0.86, 0.035]} />
      <meshPhysicalMaterial
        color="#bdcfca"
        metalness={0.05}
        opacity={0.34}
        roughness={0.16}
        transparent
      />
    </mesh>
    <BoxShell color="#414946" position={[0, 1.12, 0]} size={[railing.length, 0.07, 0.07]} />
    {Array.from({ length: postCount + 1 }, (_, index) => <BoxShell
      color="#414946"
      key={index}
      position={[-railing.length / 2 + (index * railing.length) / postCount, 0.64, 0]}
      size={[0.055, 1.02, 0.055]}
    />)}
  </group>;
}

function buildArchitecture(nodes) {
  const values = Object.values(nodes);
  const rooms = values
    .filter((node) => node.type === 'zone' && node.polygon?.length >= 3)
    .map((node) => ({
      id: node.id,
      kind: String(node.metadata?.roomKind || ''),
      polygon: node.polygon,
    }));
  const points = rooms.flatMap((room) => room.polygon);
  const bounds = {
    minX: Math.min(...points.map(([x]) => x), 0),
    maxX: Math.max(...points.map(([x]) => x), 8),
    minZ: Math.min(...points.map(([, z]) => z), 0),
    maxZ: Math.max(...points.map(([, z]) => z), 8),
  };
  const railings = buildRailings(rooms, bounds);
  const wallPieces = values
    .filter((node) => node.type === 'wall')
    .flatMap((wall) => splitWall(wall, nodes, railings, bounds));
  return {
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    railings,
    rooms,
    size: [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ],
    wallPieces,
  };
}

function buildRailings(rooms, bounds) {
  const railings = [];
  for (const room of rooms.filter((entry) => entry.kind === 'balcony')) {
    room.polygon.forEach((start, index) => {
      const end = room.polygon[(index + 1) % room.polygon.length];
      if (!onExteriorBoundary(start, end, bounds)) return;
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      railings.push({
        end,
        id: `${room.id}:railing:${index}`,
        length,
        position: [(start[0] + end[0]) / 2, 0.1, (start[1] + end[1]) / 2],
        rotation: -Math.atan2(dz, dx),
        start,
      });
    });
  }
  return railings;
}

function splitWall(wall, nodes, railings, bounds) {
  const [startX, startZ] = wall.start;
  const [endX, endZ] = wall.end;
  const dx = endX - startX;
  const dz = endZ - startZ;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return [];
  const direction = [dx / length, dz / length];
  const cuts = (wall.children || [])
    .map((id) => nodes[id])
    .filter((node) => ['door', 'window'].includes(node?.type))
    .map((node) => openingCut(node, length));
  for (const railing of railings) {
    const cut = railingCut(wall, railing, direction, length);
    if (cut) cuts.push(cut);
  }
  const stops = [...new Set([0, length, ...cuts.flatMap((cut) => [cut.start, cut.end])]
    .map((value) => clamp(value, 0, length).toFixed(5)))]
    .map(Number)
    .sort((first, second) => first - second);
  const pieces = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (to - from < EPSILON) continue;
    const middle = (from + to) / 2;
    const cut = cuts.find((entry) => middle > entry.start - EPSILON && middle < entry.end + EPSILON);
    const verticals = cut
      ? [[0, cut.bottom], [cut.top, wall.height]]
      : [[0, wall.height]];
    verticals.forEach(([bottom, top], verticalIndex) => {
      if (top - bottom < 0.035) return;
      const local = (from + to) / 2;
      pieces.push({
        exterior: onExteriorBoundary(wall.start, wall.end, bounds),
        id: `${wall.id}:${index}:${verticalIndex}`,
        position: [
          startX + direction[0] * local,
          0.1 + bottom + (top - bottom) / 2,
          startZ + direction[1] * local,
        ],
        rotation: -Math.atan2(dz, dx),
        size: [to - from, top - bottom, wall.thickness],
      });
    });
  }
  return pieces;
}

function openingCut(node, wallLength) {
  const center = Number(node.position?.[0] || 0);
  const height = Number(node.height || 0);
  const bottom = Math.max(0, Number(node.position?.[1] || height / 2) - height / 2);
  return {
    bottom,
    end: clamp(center + Number(node.width || 0) / 2, 0, wallLength),
    start: clamp(center - Number(node.width || 0) / 2, 0, wallLength),
    top: bottom + height,
  };
}

function railingCut(wall, railing, direction, wallLength) {
  if (!collinear(wall.start, wall.end, railing.start) || !collinear(wall.start, wall.end, railing.end)) return null;
  const project = ([x, z]) => (x - wall.start[0]) * direction[0] + (z - wall.start[1]) * direction[1];
  const first = project(railing.start);
  const second = project(railing.end);
  const start = clamp(Math.min(first, second), 0, wallLength);
  const end = clamp(Math.max(first, second), 0, wallLength);
  return end - start > EPSILON ? { bottom: 0.18, end, start, top: Number(wall.height || 2.85) } : null;
}

function onExteriorBoundary(start, end, bounds) {
  return (near(start[0], bounds.minX) && near(end[0], bounds.minX))
    || (near(start[0], bounds.maxX) && near(end[0], bounds.maxX))
    || (near(start[1], bounds.minZ) && near(end[1], bounds.minZ))
    || (near(start[1], bounds.maxZ) && near(end[1], bounds.maxZ));
}

function collinear(start, end, point) {
  return Math.abs((end[0] - start[0]) * (point[1] - start[1])
    - (end[1] - start[1]) * (point[0] - start[0])) < 0.002;
}

function near(first, second) {
  return Math.abs(first - second) < 0.002;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
