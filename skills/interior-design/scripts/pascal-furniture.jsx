import React from 'react';
import { RoundedBox } from '@react-three/drei';
import { AccentFinish, SurfaceFinish } from './pascal-materials.jsx';

const PALE = '#f4efe4';
const DARK = '#29332e';
const BRASS = '#a88455';
const GREEN = '#4f765f';

function BoxPart({ color, position, profile, radius = 0.025, rotation = [0, 0, 0], selected, size, variant }) {
  const usableRadius = Math.max(0.004, Math.min(radius, ...size.map((value) => value / 3)));
  return <RoundedBox args={size} castShadow position={position} radius={usableRadius} receiveShadow rotation={rotation} smoothness={2}>
    <SurfaceFinish color={color} profile={profile} selected={selected} variant={variant} />
  </RoundedBox>;
}

function CylinderPart({ args, color, position, profile, rotation = [0, 0, 0], selected, variant }) {
  return <mesh castShadow position={position} receiveShadow rotation={rotation}>
    <cylinderGeometry args={args} />
    <SurfaceFinish color={color} profile={profile} selected={selected} variant={variant} />
  </mesh>;
}

function AccentBox({ color, position, size, metal = false }) {
  return <mesh castShadow position={position} receiveShadow>
    <boxGeometry args={size} />
    <AccentFinish color={color} metal={metal} />
  </mesh>;
}

function Bed({ color, depth, height, profile, selected, width }) {
  return <>
    <BoxPart color={DARK} position={[0, 0.14, 0]} profile={profile} radius={0.05} selected={selected} size={[width, 0.22, depth]} variant="bed-frame" />
    <BoxPart color={PALE} position={[0, 0.37, 0.03]} radius={0.08} selected={selected} size={[width * 0.94, 0.27, depth * 0.9]} variant="bed-mattress" />
    <BoxPart color={color} position={[0, 0.53, depth * 0.08]} profile={profile} radius={0.06} selected={selected} size={[width * 0.9, 0.12, depth * 0.68]} variant="bed-linen" />
    <BoxPart color={DARK} position={[0, Math.max(0.62, height * 0.8), -depth * 0.47]} profile={profile} radius={0.05} selected={selected} size={[width * 1.02, Math.max(0.72, height), 0.15]} variant="bed-headboard" />
    {[-1, 1].map((side) => <BoxPart color={PALE} key={side} position={[side * width * 0.22, 0.7, -depth * 0.26]} radius={0.08} selected={selected} size={[width * 0.38, 0.15, depth * 0.22]} variant="bed-pillow" />)}
    <BoxPart color={GREEN} position={[0, 0.68, depth * 0.25]} radius={0.03} selected={selected} size={[width * 0.78, 0.07, depth * 0.22]} variant="bed-throw" />
  </>;
}

function Sofa({ color, depth, height, profile, selected, width }) {
  const seats = Math.max(2, Math.min(4, Math.round(width / 0.75)));
  return <>
    <BoxPart color={DARK} position={[0, 0.13, 0]} radius={0.04} selected={selected} size={[width * 0.94, 0.16, depth * 0.9]} variant="sofa-frame" />
    {Array.from({ length: seats }, (_, index) => <BoxPart
      color={color} key={`seat-${index}`} position={[((index + 0.5) / seats - 0.5) * width * 0.9, height * 0.39, depth * 0.06]} profile={profile}
      radius={0.08} selected={selected} size={[width * 0.86 / seats, height * 0.34, depth * 0.72]} variant="sofa-fabric"
    />)}
    {Array.from({ length: seats }, (_, index) => <BoxPart
      color={color} key={`back-${index}`} position={[((index + 0.5) / seats - 0.5) * width * 0.88, height * 0.7, -depth * 0.34]} profile={profile}
      radius={0.07} rotation={[-0.08, 0, 0]} selected={selected} size={[width * 0.84 / seats, height * 0.5, depth * 0.18]} variant="sofa-fabric"
    />)}
    {[-1, 1].map((side) => <BoxPart color={color} key={side} position={[side * width * 0.46, height * 0.43, 0]} profile={profile} radius={0.08} selected={selected} size={[0.2, height * 0.58, depth]} variant="sofa-fabric" />)}
    {[-1, 1].map((side) => <BoxPart color={side < 0 ? GREEN : '#b97c5f'} key={`pillow-${side}`} position={[side * width * 0.27, height * 0.72, -depth * 0.18]} radius={0.07} selected={selected} size={[0.34, 0.34, 0.13]} variant="sofa-pillow" />)}
  </>;
}

function Chair({ bench, color, depth, height, profile, selected, width }) {
  return <>
    <BoxPart color={color} position={[0, Math.min(height * 0.45, 0.42), 0]} profile={profile} radius={0.07} selected={selected} size={[width, 0.18, depth]} variant="chair-fabric" />
    {!bench ? <BoxPart color={color} position={[0, height * 0.7, -depth * 0.38]} profile={profile} radius={0.07} rotation={[-0.08, 0, 0]} selected={selected} size={[width * 0.88, height * 0.52, 0.14]} variant="chair-fabric" /> : null}
    {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <AccentBox color={DARK} key={`${sideX}:${sideZ}`} position={[sideX * width * 0.34, 0.2, sideZ * depth * 0.32]} size={[0.045, 0.4, 0.045]} />))}
  </>;
}

function DiningTable({ color, depth, height, profile, selected, width }) {
  return <>
    <BoxPart color={color} position={[0, height - 0.06, 0]} profile={profile} radius={0.045} selected={selected} size={[width, 0.11, depth]} variant="table-wood" />
    {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <AccentBox color={DARK} key={`${sideX}:${sideZ}`} metal position={[sideX * width * 0.39, height * 0.46, sideZ * depth * 0.34]} size={[0.055, height - 0.12, 0.055]} />))}
    {[-1, 0, 1].flatMap((row) => [-1, 1].map((side) => <group key={`${row}:${side}`} position={[row * width * 0.36, 0, side * depth * 0.86]} rotation={[0, side < 0 ? 0 : Math.PI, 0]}>
      <Chair color={side < 0 ? PALE : GREEN} depth={0.42} height={0.78} selected={selected} width={0.44} />
    </group>))}
    {[-1, 0, 1].map((slot) => <CylinderPart args={[0.11, 0.11, 0.012, 24]} color="#e9dfcc" key={slot} position={[slot * width * 0.3, height + 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} variant="stone" />)}
  </>;
}

function RoundTable({ color, depth, height, profile, selected, width }) {
  const radius = Math.min(width, depth) / 2;
  return <>
    <CylinderPart args={[radius, radius, 0.1, 36]} color={color} position={[0, height - 0.05, 0]} profile={profile} selected={selected} variant="table-wood" />
    <CylinderPart args={[0.08, 0.13, height - 0.1, 24]} color={DARK} position={[0, height * 0.48, 0]} selected={selected} variant="metal" />
    <CylinderPart args={[radius * 0.45, radius * 0.45, 0.05, 28]} color={DARK} position={[0, 0.025, 0]} selected={selected} variant="metal" />
  </>;
}

function Cabinet({ color, depth, height, kind, profile, selected, width }) {
  const panels = Math.max(1, Math.min(4, Math.round(depth / 0.52)));
  const low = height < 1.35;
  return <>
    <BoxPart color={color} position={[0, height / 2, 0]} profile={profile} radius={0.025} selected={selected} size={[width, height, depth]} variant="cabinet-wood" />
    {Array.from({ length: panels }, (_, index) => <group key={index} position={[width / 2 + 0.013, height * 0.5, ((index + 0.5) / panels - 0.5) * depth * 0.94]}>
      <AccentBox color={tintColor(color, index % 2 ? 0.06 : -0.03)} position={[0, 0, 0]} size={[0.026, height * 0.82, depth * 0.86 / panels]} />
      <AccentBox color={BRASS} metal position={[0.019, 0, depth * 0.3 / panels]} size={[0.018, Math.min(0.22, height * 0.22), 0.018]} />
    </group>)}
    {low ? <BoxPart color="#d9d1c3" position={[0, height + 0.035, 0]} radius={0.02} selected={selected} size={[width * 1.05, 0.07, depth * 1.03]} variant="stone" /> : null}
    {kind.includes('media') ? <AccentBox color="#1d2522" position={[width / 2 + 0.055, height * 0.62, 0]} size={[0.07, height * 0.52, depth * 0.74]} /> : null}
  </>;
}

function Appliance({ depth, height, selected, width }) {
  return <>
    <BoxPart color="#aeb5b1" position={[0, height / 2, 0]} radius={0.035} selected={selected} size={[width, height, depth]} variant="appliance-metal" />
    <AccentBox color="#202825" position={[width / 2 + 0.014, height * 0.68, 0]} metal size={[0.032, height * 0.48, depth * 0.78]} />
    <AccentBox color="#d6d9d5" position={[width / 2 + 0.035, height * 0.77, depth * 0.28]} metal size={[0.024, height * 0.28, 0.035]} />
    <AccentBox color="#6a726e" position={[width / 2 + 0.034, height * 0.39, 0]} metal size={[0.024, 0.025, depth * 0.58]} />
  </>;
}

function Sink({ color, depth, height, profile, selected, width }) {
  return <>
    <Cabinet color={color} depth={depth} height={height} kind="cabinet" profile={profile} selected={selected} width={width} />
    <CylinderPart args={[Math.min(width, depth) * 0.28, Math.min(width, depth) * 0.25, 0.08, 30]} color="#e9ece8" position={[0, height + 0.095, 0]} rotation={[Math.PI / 2, 0, 0]} selected={selected} variant="stone" />
    <CylinderPart args={[0.025, 0.025, 0.32, 18]} color={BRASS} position={[0, height + 0.24, -depth * 0.24]} selected={selected} variant="metal" />
  </>;
}

function Plant({ depth, height, selected, width }) {
  return <>
    <CylinderPart args={[width * 0.3, width * 0.24, height * 0.36, 20]} color="#99775e" position={[0, height * 0.18, 0]} selected={selected} variant="stone" />
    {Array.from({ length: 11 }, (_, index) => <mesh castShadow key={index} position={[Math.sin(index * 2.1) * width * 0.28, height * (0.48 + (index % 4) * 0.11), Math.cos(index * 2.1) * depth * 0.28]} rotation={[0.25, index * 1.9, index % 2 ? 0.48 : -0.48]} scale={[1.45, 0.56, 0.42]}>
      <sphereGeometry args={[width * 0.2, 14, 10]} />
      <SurfaceFinish color={index % 3 ? GREEN : '#729076'} selected={selected} variant="plant" />
    </mesh>)}
  </>;
}

export function ProceduralFurniture({ items, highlighted, materials }) {
  return items.filter((item) => item?.size?.length === 3).map((item) => <FurnitureItem item={item} key={item.id} materials={materials} selected={highlighted.has(item.id)} />);
}

function FurnitureItem({ item, materials, selected }) {
  const [width, depth, height] = item.size;
  const [x, z] = item.position;
  const profile = materials.find((material) => material.materialId === item.materialId);
  const color = profile?.baseColor || item.color || '#d8c9b6';
  const kind = String(item.kind || '').toLowerCase();
  const common = { color, depth, height, profile, selected, width };
  let content;
  if (kind.includes('rug')) content = <><BoxPart color={color} position={[0, height / 2, 0]} profile={profile} radius={0.035} selected={selected} size={[width, Math.max(height, 0.045), depth]} variant="rug-fabric" />{[-1, 1].map((side) => <AccentBox color={PALE} key={side} position={[side * width * 0.32, height + 0.009, 0]} size={[width * 0.18, 0.012, depth * 0.72]} />)}</>;
  else if (kind.includes('bed')) content = <Bed {...common} />;
  else if (kind.includes('sofa')) content = <Sofa {...common} />;
  else if (kind.includes('dining')) content = <DiningTable {...common} />;
  else if (kind.includes('table-round')) content = <RoundTable {...common} />;
  else if (/coffee-table|desk|table/.test(kind)) content = <><BoxPart color={color} position={[0, height - 0.06, 0]} profile={profile} radius={0.05} selected={selected} size={[width, 0.11, depth]} variant="table-wood" />{[-1, 1].map((side) => <AccentBox color={DARK} key={side} metal position={[side * width * 0.36, height * 0.46, 0]} size={[0.055, height - 0.12, depth * 0.7]} />)}<AccentBox color="#d1b998" position={[0, height + 0.025, 0]} size={[width * 0.28, 0.025, depth * 0.32]} /></>;
  else if (/chair|bench/.test(kind)) content = <Chair bench={kind.includes('bench')} {...common} />;
  else if (kind.includes('lamp')) content = <><CylinderPart args={[width * 0.34, width * 0.4, 0.07, 24]} color={DARK} position={[0, 0.04, 0]} selected={selected} variant="metal" /><CylinderPart args={[0.035, 0.045, height * 0.76, 18]} color={BRASS} position={[0, height * 0.41, 0]} selected={selected} variant="metal" /><CylinderPart args={[width * 0.42, width * 0.24, height * 0.22, 28]} color="#f1dcb4" position={[0, height * 0.86, 0]} selected={selected} variant="fabric" /></>;
  else if (kind.includes('plant')) content = <Plant {...common} />;
  else if (kind.includes('toilet')) content = <><BoxPart color={PALE} position={[0, height * 0.3, depth * 0.13]} radius={0.12} selected={selected} size={[width, height * 0.52, depth * 0.64]} variant="ceramic" /><CylinderPart args={[width * 0.39, width * 0.45, height * 0.32, 28]} color={PALE} position={[0, height * 0.65, -depth * 0.2]} selected={selected} variant="ceramic" /></>;
  else if (kind.includes('sink')) content = <Sink {...common} />;
  else if (kind.includes('appliance')) content = <Appliance {...common} />;
  else if (/cabinet|media/.test(kind)) content = <Cabinet kind={kind} {...common} />;
  else content = <BoxPart color={color} position={[0, height / 2, 0]} profile={profile} radius={0.035} selected={selected} size={[width, height, depth]} variant={kind} />;
  return <group name={item.id} position={[x, item.elevation || 0, z]} rotation={[0, (item.rotation || 0) * Math.PI / 180, 0]}>{content}</group>;
}

function tintColor(hex, amount) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  const channel = (shift) => Math.max(0, Math.min(255, ((value >> shift) & 255) + Math.round(255 * amount)));
  return `#${[channel(16), channel(8), channel(0)].map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
}
