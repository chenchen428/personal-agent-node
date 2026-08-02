import React, { useMemo } from 'react';
import {
  CanvasTexture,
  Color,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

const TEXTURE_CACHE = new Map();

export function SurfaceFinish({
  color,
  profile,
  selected = false,
  variant = 'object',
  transparent = false,
}) {
  const baseColor = color || profile?.baseColor || '#d8c9b6';
  const category = profile?.category || inferCategory(variant);
  const map = useMemo(
    () => surfaceTexture(baseColor, category, variant),
    [baseColor, category, variant],
  );
  return <meshPhysicalMaterial
    clearcoat={category === 'wood' || category === 'stone' ? 0.08 : 0}
    clearcoatRoughness={0.72}
    color={selected ? '#cf7651' : '#ffffff'}
    emissive={selected ? '#7a2f18' : '#000000'}
    emissiveIntensity={selected ? 0.24 : 0}
    map={selected ? null : map}
    metalness={profile?.metalness ?? (category === 'metal' ? 0.68 : 0.02)}
    opacity={transparent ? 0.48 : (profile?.opacity ?? 1)}
    roughness={profile?.roughness ?? defaultRoughness(category)}
    transparent={transparent || (profile?.opacity ?? 1) < 1}
  />;
}

export function AccentFinish({ color, emissive = false, metal = false }) {
  return <meshPhysicalMaterial
    clearcoat={metal ? 0.32 : 0.04}
    clearcoatRoughness={0.42}
    color={color}
    emissive={emissive ? color : '#000000'}
    emissiveIntensity={emissive ? 0.42 : 0}
    metalness={metal ? 0.78 : 0.02}
    roughness={metal ? 0.28 : 0.72}
  />;
}

function surfaceTexture(color, category, variant) {
  if (typeof document === 'undefined') return null;
  const key = `${color}:${category}:${variant}`;
  if (TEXTURE_CACHE.has(key)) return TEXTURE_CACHE.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const base = new Color(color);
  context.fillStyle = `#${base.getHexString()}`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (category === 'wood') drawWood(context, base);
  else if (category === 'stone' || /bath|kitchen|balcony/.test(variant)) drawStone(context, base);
  else if (category === 'fabric') drawFabric(context, base);
  else if (category === 'metal') drawMetal(context, base);
  else drawPlaster(context, base);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(category === 'fabric' ? 5 : 3, category === 'fabric' ? 5 : 3);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  TEXTURE_CACHE.set(key, texture);
  return texture;
}

function drawWood(context, base) {
  const light = tint(base, 0.11);
  const dark = tint(base, -0.12);
  for (let y = 0; y < 192; y += 32) {
    context.fillStyle = y % 64 ? light : `#${base.getHexString()}`;
    context.fillRect(0, y, 192, 31);
    context.strokeStyle = dark;
    context.globalAlpha = 0.34;
    context.strokeRect(0, y, 192, 32);
    context.globalAlpha = 0.16;
    for (let line = 0; line < 4; line += 1) {
      context.beginPath();
      context.moveTo(0, y + 5 + line * 6);
      context.bezierCurveTo(52, y + line * 6, 122, y + 12 + line * 5, 192, y + 4 + line * 6);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

function drawStone(context, base) {
  context.strokeStyle = tint(base, -0.15);
  context.globalAlpha = 0.26;
  for (let value = 0; value <= 192; value += 64) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, 192); context.stroke();
    context.beginPath(); context.moveTo(0, value); context.lineTo(192, value); context.stroke();
  }
  for (let index = 0; index < 96; index += 1) {
    const x = (index * 47) % 191;
    const y = (index * 83) % 191;
    context.fillStyle = index % 3 ? tint(base, 0.15) : tint(base, -0.14);
    context.globalAlpha = 0.18;
    context.fillRect(x, y, index % 4 === 0 ? 2 : 1, 1);
  }
  context.globalAlpha = 1;
}

function drawFabric(context, base) {
  context.strokeStyle = tint(base, -0.18);
  context.globalAlpha = 0.13;
  for (let value = 0; value < 192; value += 6) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, 192); context.stroke();
    context.beginPath(); context.moveTo(0, value); context.lineTo(192, value); context.stroke();
  }
  context.globalAlpha = 1;
}

function drawMetal(context, base) {
  const gradient = context.createLinearGradient(0, 0, 192, 0);
  gradient.addColorStop(0, tint(base, -0.12));
  gradient.addColorStop(0.48, tint(base, 0.16));
  gradient.addColorStop(1, tint(base, -0.08));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 192, 192);
}

function drawPlaster(context, base) {
  for (let index = 0; index < 120; index += 1) {
    context.fillStyle = index % 2 ? tint(base, 0.08) : tint(base, -0.07);
    context.globalAlpha = 0.08;
    context.fillRect((index * 61) % 191, (index * 37) % 191, 1, 1);
  }
  context.globalAlpha = 1;
}

function tint(color, amount) {
  const next = color.clone();
  if (amount >= 0) next.lerp(new Color('#ffffff'), amount);
  else next.lerp(new Color('#151915'), -amount);
  return `#${next.getHexString()}`;
}

function inferCategory(variant) {
  if (/metal|appliance/.test(variant)) return 'metal';
  if (/fabric|rug|sofa|bed/.test(variant)) return 'fabric';
  if (/stone|bath|kitchen|balcony/.test(variant)) return 'stone';
  if (/wood|cabinet|table|floor/.test(variant)) return 'wood';
  return 'plaster';
}

function defaultRoughness(category) {
  if (category === 'metal') return 0.34;
  if (category === 'stone') return 0.66;
  if (category === 'wood') return 0.58;
  if (category === 'fabric') return 0.9;
  return 0.78;
}
