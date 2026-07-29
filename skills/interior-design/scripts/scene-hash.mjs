import crypto from 'node:crypto';

export function compiledSceneHash(scene, furniture = []) {
  const normalizedScene = structuredClone(scene);
  for (const node of Object.values(normalizedScene.nodes || {})) {
    const provenance = node.metadata?.personalAgent;
    if (!provenance) continue;
    delete provenance.projectId;
    delete provenance.revision;
    if (!Object.keys(provenance).length) delete node.metadata.personalAgent;
    if (node.metadata && !Object.keys(node.metadata).length) delete node.metadata;
  }
  return crypto.createHash('sha256').update(canonicalJson({ scene: normalizedScene, furniture })).digest('hex');
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 10000) / 10000;
  return value;
}
