import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, initializeProject, projectError, selectedConcept, sha256 } from './project-v2.mjs';
import { compiledSceneHash } from './scene-hash.mjs';

const PASCAL_CORE_VERSION = '0.9.2';
const PASCAL_MCP_VERSION = '0.3.2';
const ADAPTER_VERSION = 1;

export class PascalInteriorAdapter {
  constructor({ runtimeFactory } = {}) {
    this.runtimeFactory = runtimeFactory || defaultRuntimeFactory;
  }

  async createProject({ projectDir, seed, context, compile = false }) {
    const initialized = initializeProject(projectDir, seed, context);
    if (!compile) return initialized;
    const { compileProjectScene } = await import('./scene-v2.mjs');
    return compileProjectScene(initialized.projectDir, context, { baseRevision: initialized.project.revision, adapter: this });
  }

  async compileScene(project) {
    const concept = selectedConcept(project);
    if (!concept) throw projectError('SELECTED_CONCEPT_MISSING', 'selected concept does not resolve', 2);
    const runtime = await this.runtimeFactory({
      sceneId: `scene-${project.projectId}`,
      projectId: project.projectId,
      ownerId: project.ownerId,
      version: project.revision,
    });
    const sourceMap = new Map();
    const pageFurniture = [];
    try {
      const initial = await runtime.call('get_scene');
      const initialNodes = Object.values(initial.nodes || {});
      const site = initialNodes.find((node) => node.type === 'site');
      const building = initialNodes.find((node) => node.type === 'building');
      const defaultLevel = initialNodes.find((node) => node.type === 'level');
      if (!site || !building || !defaultLevel) throw projectError('PASCAL_DEFAULT_SCENE_INVALID', 'Pascal did not create Site → Building → Level', 7);
      remember(sourceMap, site.id, 'site', project.projectId);
      remember(sourceMap, building.id, 'building', project.projectId);
      await runtime.call('apply_patch', {
        patches: [
          { op: 'update', id: site.id, data: { name: project.title, metadata: personalAgentMetadata(project, { sourceId: project.projectId }) } },
          { op: 'update', id: building.id, data: { name: project.title, metadata: personalAgentMetadata(project, { sourceId: 'building' }) } },
        ],
      });

      const orderedLevels = [...concept.levels].sort((a, b) => a.elevation - b.elevation || a.levelId.localeCompare(b.levelId));
      const levelRuntimeIds = new Map();
      for (let index = 0; index < orderedLevels.length; index += 1) {
        const level = orderedLevels[index];
        let runtimeLevelId = defaultLevel.id;
        if (index > 0) {
          const created = await runtime.call('create_level', {
            buildingId: building.id,
            elevation: level.elevation,
            height: level.height,
            label: level.name,
          });
          runtimeLevelId = created.levelId;
        }
        levelRuntimeIds.set(level.levelId, runtimeLevelId);
        remember(sourceMap, runtimeLevelId, 'level', level.levelId);
        await runtime.call('apply_patch', {
          patches: [{
            op: 'update',
            id: runtimeLevelId,
            data: {
              name: level.name,
              level: index,
              metadata: personalAgentMetadata(project, {
                sourceId: level.levelId,
                elevation: level.elevation,
                height: level.height,
                furniture: level.items.map((item) => item.itemId),
              }),
            },
          }],
        });
      }

      for (const level of orderedLevels) {
        const runtimeLevelId = levelRuntimeIds.get(level.levelId);
        const shell = await runtime.call('create_story_shell', {
          levelId: runtimeLevelId,
          footprint: level.footprint,
          wallHeight: level.height,
          wallThickness: exteriorThickness(level),
          createSlab: true,
          createCeiling: true,
        });
        remember(sourceMap, shell.slabId, 'slab', `${level.levelId}-slab`);
        remember(sourceMap, shell.ceilingId, 'ceiling', `${level.levelId}-ceiling`);

        const wallRuntimeIds = new Map();
        for (const wall of level.walls) {
          const exteriorIndex = Number.isInteger(wall.exteriorEdge) ? wall.exteriorEdge : -1;
          if (exteriorIndex >= 0 && shell.wallIds[exteriorIndex]) {
            wallRuntimeIds.set(wall.wallId, shell.wallIds[exteriorIndex]);
            remember(sourceMap, shell.wallIds[exteriorIndex], 'wall', wall.wallId);
          } else {
            const created = await runtime.call('create_wall', {
              levelId: runtimeLevelId,
              start: wall.start,
              end: wall.end,
              thickness: wall.thickness,
              height: wall.height,
            });
            wallRuntimeIds.set(wall.wallId, created.wallId);
            remember(sourceMap, created.wallId, 'wall', wall.wallId);
          }
        }

        for (let edgeIndex = 0; edgeIndex < shell.wallIds.length; edgeIndex += 1) {
          if (!sourceMap.has(shell.wallIds[edgeIndex])) remember(sourceMap, shell.wallIds[edgeIndex], 'wall', `${level.levelId}-shell-${edgeIndex + 1}`);
        }

        for (const room of level.rooms) {
          const created = await runtime.call('set_zone', {
            levelId: runtimeLevelId,
            polygon: room.polygon,
            label: room.name,
            properties: {
              roomKind: room.kind,
              sourceId: room.roomId,
              requiredAccess: room.requiredAccess !== false,
            },
          });
          remember(sourceMap, created.zoneId, 'zone', room.roomId);
        }

        for (const opening of level.openings) {
          const wallId = wallRuntimeIds.get(opening.wallId);
          if (!wallId) throw projectError('OPENING_WALL_MISSING', `opening ${opening.openingId} wall is missing`, 2);
          const created = opening.type === 'door'
            ? await runtime.call('add_door', {
              wallId,
              t: opening.position,
              width: opening.width,
              height: opening.height,
              hingesSide: opening.hingesSide || 'left',
              swingDirection: opening.swingDirection || 'inward',
            })
            : await runtime.call('add_window', {
              wallId,
              t: opening.position,
              width: opening.width,
              height: opening.height,
              sillHeight: opening.sillHeight || 0.9,
            });
          const openingRuntimeId = created.doorId || created.windowId;
          remember(sourceMap, openingRuntimeId, opening.type, opening.openingId);
        }

        for (const stair of level.stairs) {
          const targetLevelId = levelRuntimeIds.get(stair.toLevelId);
          const created = await runtime.call('create_stair_between_levels', {
            fromLevelId: runtimeLevelId,
            toLevelId: targetLevelId,
            position: [stair.position[0], level.elevation, stair.position[1]],
            width: stair.width,
            runLength: stair.runLength,
            totalRise: stair.totalRise,
          });
          remember(sourceMap, created.stairId, 'stair', stair.stairId);
        }

        for (const guardrail of level.guardrails) {
          const temporaryId = `fence_${sha256(`${project.projectId}:${guardrail.guardrailId}`).slice(0, 16)}`;
          await runtime.call('apply_patch', {
            patches: [{
              op: 'create',
              parentId: runtimeLevelId,
              node: {
                id: temporaryId,
                type: 'fence',
                name: guardrail.name || 'Guardrail',
                start: guardrail.start,
                end: guardrail.end,
                height: guardrail.height || 1.05,
                thickness: guardrail.thickness || 0.06,
                style: guardrail.style || 'slat',
                metadata: personalAgentMetadata(project, { sourceId: guardrail.guardrailId }),
              },
            }],
          });
          remember(sourceMap, temporaryId, 'fence', guardrail.guardrailId);
        }

        for (const item of level.items) {
          pageFurniture.push({
            id: stableId('item', item.itemId, project.projectId),
            sourceId: item.itemId,
            levelId: stableId('level', level.levelId, project.projectId),
            roomId: item.roomId,
            name: item.name,
            kind: item.kind,
            position: item.position,
            size: item.size,
            rotation: item.rotation,
            elevation: level.elevation,
            color: item.color,
            requirementIds: item.requirementIds || [],
          });
        }
      }

      const pascalValidation = await runtime.call('validate_scene');
      if (!pascalValidation.valid) {
        throw projectError('PASCAL_VALIDATION_FAILED', 'Pascal rejected the compiled scene', 8, { errors: pascalValidation.errors });
      }
      const exported = runtime.exportScene();
      const canonical = canonicalizePascalScene(exported, sourceMap, project);
      const verifier = await this.runtimeFactory({
        sceneId: `verify-${project.projectId}`,
        projectId: project.projectId,
        ownerId: project.ownerId,
        version: project.revision,
      });
      try {
        const verification = verifier.loadScene(canonical);
        if (!verification.valid) throw projectError('PASCAL_CANONICAL_VALIDATION_FAILED', 'canonical Pascal scene is invalid', 8, { errors: verification.errors });
      } finally {
        await verifier.close();
      }
      const sortedFurniture = pageFurniture.sort((a, b) => a.id.localeCompare(b.id));
      const sceneHash = compiledSceneHash(canonical, sortedFurniture);
      const mappings = [
        ...[...sourceMap.values()].map((entry) => [entry.sourceId, stableId(entry.type, entry.sourceId, project.projectId)]),
        ...pageFurniture.map((entry) => [entry.sourceId, entry.id]),
      ];
      return {
        schemaVersion: 1,
        engine: 'pascal-v2',
        adapterVersion: ADAPTER_VERSION,
        pascal: { coreVersion: PASCAL_CORE_VERSION, mcpVersion: PASCAL_MCP_VERSION },
        projectId: project.projectId,
        revision: project.revision,
        modelBasis: {
          evidenceId: project.provenance.sourcePlanEvidenceId,
          sha256: project.provenance.sourcePlanSha256,
        },
        sceneHash,
        scene: canonical,
        mappings: Object.fromEntries(mappings.sort(([a], [b]) => a.localeCompare(b))),
        furniture: sortedFurniture,
      };
    } finally {
      await runtime.close();
    }
  }

  async validateScene(scenePayload) {
    const runtime = await this.runtimeFactory({
      sceneId: `validate-${scenePayload.projectId || 'scene'}`,
      projectId: scenePayload.projectId || 'project',
      ownerId: 'validation',
      version: scenePayload.revision || 1,
    });
    try {
      return runtime.loadScene(scenePayload.scene || scenePayload);
    } finally {
      await runtime.close();
    }
  }

  async validate(snapshot) {
    return this.validateScene(snapshot);
  }

  async queryScene({ snapshot, nodeIds = [], sourceIds = [], types = [] }) {
    if (!snapshot?.scene?.nodes || !Array.isArray(nodeIds) || !Array.isArray(sourceIds) || !Array.isArray(types)) {
      throw projectError('INVALID_SCENE_QUERY', 'scene query requires a compiled snapshot and array filters', 2);
    }
    if (nodeIds.length + sourceIds.length + types.length > 100) throw projectError('INVALID_SCENE_QUERY', 'scene query accepts at most 100 filters', 2);
    const resolvedIds = new Set([
      ...nodeIds,
      ...sourceIds.map((sourceId) => snapshot.mappings?.[sourceId]).filter(Boolean),
    ]);
    const typeSet = new Set(types);
    const nodes = Object.values(snapshot.scene.nodes)
      .filter((node) => (!resolvedIds.size || resolvedIds.has(node.id)) && (!typeSet.size || typeSet.has(node.type)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 500);
    return {
      sceneHash: snapshot.sceneHash,
      revision: snapshot.revision,
      nodes: structuredClone(nodes),
    };
  }

  async applyOperations({ projectDir, context, operations, baseRevision }) {
    const { applySceneOperations } = await import('./scene-v2.mjs');
    return applySceneOperations(projectDir, context, operations, { baseRevision, adapter: this });
  }

  async undo({ projectDir, context, baseRevision }) {
    const { undoProjectRevision } = await import('./scene-v2.mjs');
    return undoProjectRevision(projectDir, context, { baseRevision, adapter: this });
  }

  async redo({ projectDir, context, baseRevision }) {
    const { redoProjectRevision } = await import('./scene-v2.mjs');
    return redoProjectRevision(projectDir, context, { baseRevision, adapter: this });
  }

  exportForPage(snapshot) {
    if (!snapshot?.scene?.nodes || snapshot.engine !== 'pascal-v2') throw projectError('INVALID_SCENE_EXPORT', 'a compiled Pascal v2 snapshot is required', 2);
    const idMap = new Map();
    for (const [index, oldId] of traversalOrder(snapshot.scene).entries()) {
      const type = snapshot.scene.nodes[oldId]?.type || 'node';
      idMap.set(oldId, `page-${cleanToken(type)}-${String(index + 1).padStart(4, '0')}`);
    }
    const orderedFurniture = [...(snapshot.furniture || [])].sort((a, b) => a.id.localeCompare(b.id));
    orderedFurniture.forEach((entry, index) => idMap.set(entry.id, `page-item-${String(index + 1).padStart(4, '0')}`));
    const scene = replaceIds(structuredClone(snapshot.scene), idMap);
    for (const node of Object.values(scene.nodes || {})) {
      if (node.metadata?.personalAgent) delete node.metadata.personalAgent;
      if (node.metadata && !Object.keys(node.metadata).length) delete node.metadata;
    }
    stripPagePrivateFields(scene);
    const furniture = orderedFurniture.map(({ sourceId, roomId, requirementIds, ...entry }) => replaceIds(entry, idMap));
    const payload = {
      schemaVersion: 1,
      engine: 'pascal-v2',
      revision: snapshot.revision,
      sourcePlanSha256: snapshot.modelBasis?.sha256,
      sceneHash: sha256(canonicalJson({ scene, furniture })),
      scene,
      furniture,
    };
    const pageMappings = Object.fromEntries(Object.entries(snapshot.mappings || {})
      .map(([sourceId, canonicalId]) => [sourceId, idMap.get(canonicalId)])
      .filter(([, pageId]) => Boolean(pageId))
      .sort(([a], [b]) => a.localeCompare(b)));
    return { payload, pageMappings };
  }
}

function stripPagePrivateFields(value) {
  if (Array.isArray(value)) {
    value.forEach(stripPagePrivateFields);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of ['projectId', 'ownerId', 'spaceId', 'managedObjectId', 'sourceId', 'requirementIds', 'decisionIds', 'evidenceIds']) {
    delete value[key];
  }
  Object.values(value).forEach(stripPagePrivateFields);
}

export function canonicalizePascalScene(scene, sourceMap, project) {
  const nodes = scene.nodes || {};
  const idMap = new Map();
  for (const [oldId, entry] of sourceMap) idMap.set(oldId, stableId(entry.type, entry.sourceId, project.projectId));
  const orderedIds = traversalOrder(scene);
  for (let index = 0; index < orderedIds.length; index += 1) {
    const oldId = orderedIds[index];
    if (idMap.has(oldId)) continue;
    const node = nodes[oldId];
    const source = `${node.type}-${index + 1}-${sha256(canonicalJson(stripReferences(node))).slice(0, 8)}`;
    idMap.set(oldId, stableId(node.type, source, project.projectId));
  }
  const replacedNodes = {};
  for (const oldId of orderedIds) {
    const node = replaceIds(nodes[oldId], idMap);
    node.id = idMap.get(oldId);
    node.children = (nodes[oldId].children || []).map((child) => idMap.get(typeof child === 'string' ? child : child.id)).filter(Boolean);
    node.metadata = {
      ...(node.metadata || {}),
      personalAgent: {
        ...(node.metadata?.personalAgent || {}),
        projectId: project.projectId,
        revision: project.revision,
      },
    };
    replacedNodes[node.id] = node;
  }
  const site = Object.values(replacedNodes).find((node) => node.type === 'site');
  const building = Object.values(replacedNodes).find((node) => node.type === 'building');
  if (site) site.parentId = null;
  if (building) building.parentId = site?.id || null;
  for (const node of Object.values(replacedNodes)) {
    if (node.type === 'level' && !node.parentId) node.parentId = building?.id || null;
  }
  return {
    nodes: Object.fromEntries(Object.entries(replacedNodes).sort(([a], [b]) => a.localeCompare(b))),
    rootNodeIds: (scene.rootNodeIds || []).map((id) => idMap.get(id)).filter(Boolean).sort(),
    collections: replaceIds(scene.collections || {}, idMap),
    materials: replaceIds(scene.materials || {}, idMap),
  };
}

export function stableId(type, sourceId, projectId) {
  const prefix = ({
    'stair-segment': 'sseg',
    site: 'site',
    building: 'building',
    level: 'level',
    wall: 'wall',
    slab: 'slab',
    ceiling: 'ceiling',
    zone: 'zone',
    door: 'door',
    window: 'window',
    stair: 'stair',
    fence: 'fence',
    item: 'item',
    roof: 'roof',
    'roof-segment': 'rseg',
  })[type] || cleanToken(type);
  return `${prefix}_${cleanToken(sourceId).slice(0, 36)}_${sha256(`${projectId}:${type}:${sourceId}`).slice(0, 10)}`;
}

function traversalOrder(scene) {
  const nodes = scene.nodes || {};
  const visited = new Set();
  const ordered = [];
  const visit = (id) => {
    if (!id || visited.has(id) || !nodes[id]) return;
    visited.add(id);
    ordered.push(id);
    for (const child of nodes[id].children || []) visit(typeof child === 'string' ? child : child?.id);
    const inferred = Object.values(nodes)
      .filter((node) => node.parentId === id && !visited.has(node.id))
      .sort(compareNodes);
    for (const child of inferred) visit(child.id);
  };
  for (const rootId of [...(scene.rootNodeIds || [])].sort()) visit(rootId);
  for (const node of Object.values(nodes).sort(compareNodes)) visit(node.id);
  return ordered;
}

function compareNodes(a, b) {
  return `${a.type}:${canonicalJson(stripReferences(a))}`.localeCompare(`${b.type}:${canonicalJson(stripReferences(b))}`);
}

function stripReferences(value) {
  const copy = structuredClone(value);
  for (const key of ['id', 'parentId', 'children', 'wallId', 'fromLevelId', 'toLevelId', 'levelId']) delete copy[key];
  return copy;
}

function replaceIds(value, map) {
  if (typeof value === 'string') return map.get(value) || value;
  if (Array.isArray(value)) return value.map((entry) => replaceIds(entry, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [map.get(key) || key, replaceIds(entry, map)]));
  }
  return value;
}

function remember(map, runtimeId, type, sourceId) {
  if (runtimeId) map.set(runtimeId, { type, sourceId });
}

function personalAgentMetadata(project, data) {
  return { personalAgent: { projectId: project.projectId, revision: project.revision, ...data } };
}

function exteriorThickness(level) {
  const values = level.walls.filter((wall) => Number.isInteger(wall.exteriorEdge) && wall.exteriorEdge >= 0).map((wall) => wall.thickness);
  return values.length ? Math.max(...values) : 0.18;
}

function cleanToken(value) {
  return String(value || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

async function defaultRuntimeFactory(options) {
  const module = await loadPascalRuntimeModule();
  return module.createPascalRuntime(options);
}

let runtimeModulePromise;

export async function loadPascalRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = (async () => {
      const assetsRoot = path.resolve(import.meta.dirname, '..', 'assets');
      const manifestPath = path.join(assetsRoot, 'pascal-runtime-manifest.json');
      const bundlePath = path.join(assetsRoot, 'pascal-headless.bundle');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const expected = manifest.artifacts?.['pascal-headless.bundle'];
      if (!expected) throw projectError('PASCAL_RUNTIME_MANIFEST_INVALID', 'headless Pascal runtime is not declared', 7);
      const bundle = fs.readFileSync(bundlePath);
      if (bundle.length !== expected.bytes || sha256(bundle) !== expected.sha256) {
        throw projectError('PASCAL_RUNTIME_HASH_MISMATCH', 'headless Pascal runtime failed integrity verification', 7);
      }
      return import(`data:text/javascript;base64,${bundle.toString('base64')}`);
    })().catch((error) => {
      runtimeModulePromise = undefined;
      throw error;
    });
  }
  return runtimeModulePromise;
}

export const PASCAL_ADAPTER_INFO = Object.freeze({
  adapterVersion: ADAPTER_VERSION,
  coreVersion: PASCAL_CORE_VERSION,
  mcpVersion: PASCAL_MCP_VERSION,
});
