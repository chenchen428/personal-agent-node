const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const REQUIRED_CONTROL_PASSES = Object.freeze(['depth', 'normal', 'semantic', 'object-id']);

export function compileDesignQuality(project) {
  const intent = project.designIntent || {};
  const rendering = intent.rendering || {};
  return {
    schemaVersion: 1,
    style: stringList(intent.style, 12),
    materials: objectList(intent.materials, 64).map((material) => ({
      materialId: text(material.materialId),
      name: text(material.name),
      category: text(material.category),
      baseColor: color(material.baseColor || material.color),
      roughness: bounded(material.roughness, 0, 1, 0.72),
      metalness: bounded(material.metalness, 0, 1, 0),
      opacity: bounded(material.opacity, 0.05, 1, 1),
      wetAreaSuitability: text(material.wetAreaSuitability),
    })).sort((a, b) => a.materialId.localeCompare(b.materialId)),
    lights: objectList(intent.lighting, 32).map((light, index) => ({
      lightId: text(light.lightId || `light-${index + 1}`),
      name: text(light.name || light.intent || `Light ${index + 1}`),
      kind: text(light.kind || light.mode),
      roomId: text(light.roomId),
      position: vector3(light.position),
      target: vector3(light.target),
      intensity: bounded(light.intensity, 0, 20_000, 0),
      colorTemperatureKelvin: bounded(light.colorTemperatureKelvin, 1_500, 10_000, 3_500),
      color: color(light.color || '#fff4e6'),
    })).sort((a, b) => a.lightId.localeCompare(b.lightId)),
    cameras: objectList(rendering.cameras, 24).map((camera, index) => ({
      cameraId: text(camera.cameraId || `camera-${index + 1}`),
      name: text(camera.name || `Camera ${index + 1}`),
      role: text(camera.role || 'supporting'),
      roomId: text(camera.roomId),
      position: vector3(camera.position),
      target: vector3(camera.target),
      fov: bounded(camera.fov, 20, 90, 50),
      sequence: Math.max(0, Math.round(Number(camera.sequence) || index)),
    })).sort((a, b) => a.sequence - b.sequence || a.cameraId.localeCompare(b.cameraId)),
    rendering: {
      realtimeProfile: text(rendering.realtimeProfile),
      finalProfile: text(rendering.finalProfile),
      geometryLocked: rendering.geometryLocked === true,
      aiEnhancement: text(rendering.aiEnhancement || 'off'),
      controlPasses: stringList(rendering.controlPasses, 12).sort(),
      exposure: bounded(rendering.exposure, 0.2, 3, 1),
    },
  };
}

export function withDefaultAssetProfiles(concepts) {
  return objectList(concepts, 8).map((concept) => ({
    ...concept,
    levels: objectList(concept.levels, 2).map((level) => ({
      ...level,
      items: objectList(level.items, 500).map((item) => ({
        ...item,
        assetProfile: item.assetProfile || defaultAssetProfile(item),
      })),
    })),
  }));
}

export function defaultAssetProfile(item) {
  const kind = text(item.kind || 'object').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'object';
  const clearance = useClearance(kind);
  return {
    assetId: `builtin-${kind}`,
    version: 1,
    anchor: /lamp|pendant|ceiling/.test(kind) ? 'ceiling' : /wall|media/.test(kind) ? 'wall' : 'floor',
    scalePolicy: 'bounded-proportional',
    operatingClearance: {
      front: clearance,
      back: 0,
      left: Math.min(clearance, 0.15),
      right: Math.min(clearance, 0.15),
      top: 0,
    },
  };
}

export function validHexColor(value) {
  return HEX_COLOR.test(value || '');
}

function useClearance(kind) {
  if (/bed/.test(kind)) return 0.45;
  if (/dining|table|desk/.test(kind)) return 0.55;
  if (/toilet|wash|sink/.test(kind)) return 0.45;
  if (/cabinet|fridge|appliance/.test(kind)) return 0.35;
  return 0;
}

function objectList(value, maximum) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object').slice(0, maximum) : [];
}

function stringList(value, maximum) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, maximum) : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim().slice(0, 240) : '';
}

function color(value) {
  return validHexColor(value) ? value.toLowerCase() : '#b8b1a6';
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function vector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value.map((entry) => Math.round(entry * 10_000) / 10_000)
    : null;
}
