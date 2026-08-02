import React, { createContext, useContext, useMemo } from 'react';
import {
  CanvasTexture,
  Color,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

const TEXTURE_CACHE = new Map();
const DeliveryStyleContext = createContext(null);

export function DeliveryStyleProvider({ children, style }) {
  return <DeliveryStyleContext.Provider value={style}>{children}</DeliveryStyleContext.Provider>;
}

export function useDeliveryStyle() {
  return useContext(DeliveryStyleContext);
}

export function SurfaceFinish({
  color,
  profile,
  selected = false,
  variant = 'object',
  transparent = false,
}) {
  const style = useDeliveryStyle();
  const category = profile?.category || inferCategory(variant);
  const baseColor = styledSurfaceColor(style, category, variant, color || profile?.baseColor || '#d8c9b6');
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
  const style = useDeliveryStyle();
  const resolvedColor = styledAccentColor(style, color, metal);
  return <meshPhysicalMaterial
    clearcoat={metal ? 0.32 : 0.04}
    clearcoatRoughness={0.42}
    color={resolvedColor}
    emissive={emissive ? resolvedColor : '#000000'}
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
  canvas.width = 384;
  canvas.height = 384;
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
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  TEXTURE_CACHE.set(key, texture);
  return texture;
}

function drawWood(context, base) {
  const size = context.canvas.width;
  const light = tint(base, 0.11);
  const dark = tint(base, -0.12);
  for (let y = 0; y < size; y += 48) {
    context.fillStyle = y % 96 ? light : `#${base.getHexString()}`;
    context.fillRect(0, y, size, 47);
    context.strokeStyle = dark;
    context.globalAlpha = 0.34;
    context.strokeRect(0, y, size, 48);
    context.globalAlpha = 0.16;
    for (let line = 0; line < 4; line += 1) {
      context.beginPath();
      context.moveTo(0, y + 7 + line * 9);
      context.bezierCurveTo(size * .27, y + line * 9, size * .64, y + 18 + line * 7, size, y + 6 + line * 9);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

function drawStone(context, base) {
  const size = context.canvas.width;
  context.strokeStyle = tint(base, -0.15);
  context.globalAlpha = 0.26;
  for (let value = 0; value <= size; value += 96) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, size); context.stroke();
    context.beginPath(); context.moveTo(0, value); context.lineTo(size, value); context.stroke();
  }
  for (let index = 0; index < 192; index += 1) {
    const x = (index * 47) % (size - 1);
    const y = (index * 83) % (size - 1);
    context.fillStyle = index % 3 ? tint(base, 0.15) : tint(base, -0.14);
    context.globalAlpha = 0.18;
    context.fillRect(x, y, index % 4 === 0 ? 2 : 1, 1);
  }
  context.globalAlpha = 1;
}

function drawFabric(context, base) {
  const size = context.canvas.width;
  context.strokeStyle = tint(base, -0.18);
  context.globalAlpha = 0.13;
  for (let value = 0; value < size; value += 8) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, size); context.stroke();
    context.beginPath(); context.moveTo(0, value); context.lineTo(size, value); context.stroke();
  }
  context.globalAlpha = 1;
}

function drawMetal(context, base) {
  const size = context.canvas.width;
  const gradient = context.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, tint(base, -0.12));
  gradient.addColorStop(0.48, tint(base, 0.16));
  gradient.addColorStop(1, tint(base, -0.08));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
}

function drawPlaster(context, base) {
  const size = context.canvas.width;
  for (let index = 0; index < 240; index += 1) {
    context.fillStyle = index % 2 ? tint(base, 0.08) : tint(base, -0.07);
    context.globalAlpha = 0.08;
    context.fillRect((index * 61) % (size - 1), (index * 37) % (size - 1), 1, 1);
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

function styledSurfaceColor(style, category, variant, fallback) {
  const palette = style?.palette;
  if (!palette) return fallback;
  if (/plant/.test(variant)) return palette.plant;
  if (/throw|pillow|accent/.test(variant)) return palette.accent;
  if (category === 'fabric') return palette.fabric;
  if (category === 'metal') return palette.metal;
  if (/floor/.test(variant)) return palette.floor;
  if (/frame|headboard|media|dark/.test(variant)) return palette.darkWood;
  if (category === 'wood' || /cabinet|table|joinery/.test(variant)) return palette.wood;
  if (category === 'stone' || /bath|kitchen|laundry|balcony/.test(variant)) return palette.stone;
  return palette.plaster;
}

function styledAccentColor(style, fallback, metal) {
  const palette = style?.palette;
  if (!palette) return fallback;
  if (metal) return palette.metal;
  const normalized = String(fallback || '').toLowerCase();
  if (['#30453b', '#567c68', '#4b7260'].includes(normalized)) return palette.accent;
  if (['#2b302d', '#252a27', '#30352f'].includes(normalized)) return palette.darkWood;
  return fallback;
}
