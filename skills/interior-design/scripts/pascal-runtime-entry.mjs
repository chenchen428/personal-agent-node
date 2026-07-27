import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPascalMcpServer, SceneBridge } from '@pascal-app/mcp';

const ALLOWED_TOOLS = new Set([
  'get_scene',
  'get_node',
  'describe_node',
  'find_nodes',
  'list_levels',
  'get_level_summary',
  'get_walls',
  'get_zones',
  'measure',
  'create_story_shell',
  'create_stair_between_levels',
  'create_roof',
  'create_room',
  'add_door',
  'add_window',
  'apply_patch',
  'create_level',
  'create_wall',
  'set_zone',
  'duplicate_level',
  'delete_node',
  'undo',
  'redo',
  'export_json',
  'validate_scene',
  'verify_scene',
  'check_collisions',
]);

export async function createPascalRuntime({
  sceneId = 'personal-agent-scene',
  projectId = 'personal-agent-project',
  ownerId = 'personal-agent-owner',
  version = 1,
} = {}) {
  const bridge = new SceneBridge();
  bridge.setScene({}, []);
  bridge.clearHistory();
  bridge.loadDefault();
  bridge.setActiveScene({
    id: sceneId,
    name: sceneId,
    projectId,
    ownerId,
    thumbnailUrl: null,
    version,
  });
  const server = createPascalMcpServer({ bridge });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'personal-agent-interior-design', version: '2.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    allowedTools: [...ALLOWED_TOOLS],
    async call(name, args = {}) {
      if (!ALLOWED_TOOLS.has(name)) throw new Error(`Pascal tool is not allowed: ${name}`);
      validatePersonalAgentArguments(name, args);
      const response = await client.callTool({ name, arguments: args });
      if (response.isError) {
        const detail = Array.isArray(response.content)
          ? response.content.map((entry) => entry?.text || '').filter(Boolean).join('; ')
          : '';
        throw new Error(`Pascal ${name} failed${detail ? `: ${detail}` : ''}`);
      }
      return response.structuredContent ?? response.content ?? null;
    },
    exportScene() {
      return bridge.exportJSON();
    },
    loadScene(scene) {
      bridge.loadJSON(scene);
      return bridge.validateScene();
    },
    validateScene() {
      return bridge.validateScene();
    },
    history() {
      return bridge.getHistory();
    },
    async close() {
      await client.close();
      await server.close();
      bridge.setScene({}, []);
      bridge.clearHistory();
    },
  };
}

export function validatePersonalAgentArguments(name, args) {
  if (!ALLOWED_TOOLS.has(name)) throw new Error(`Pascal tool is not allowed: ${name}`);
  if (!plainObject(args)) throw new Error(`Pascal ${name} arguments must be a plain object`);
  const encoded = JSON.stringify(args);
  if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error(`Pascal ${name} arguments exceed 1 MiB`);
  const queue = [{ value: args, depth: 0, key: '' }];
  let visited = 0;
  while (queue.length) {
    const { value, depth, key } = queue.shift();
    visited += 1;
    if (visited > 20_000) throw new Error(`Pascal ${name} arguments contain too many values`);
    if (depth > 30) throw new Error(`Pascal ${name} arguments are too deeply nested`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Pascal ${name} arguments contain a non-finite number`);
    if (typeof value === 'string') {
      if (value.length > 20_000) throw new Error(`Pascal ${name} arguments contain an oversized string`);
      if (/(?:url|uri|path|href|src|asset|texture|file)/i.test(key)
        && (/^(?:https?|file|ftp|data):/i.test(value) || pathLike(value))) {
        throw new Error(`Pascal ${name} arguments contain a forbidden asset, URL, or host path`);
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 10_000) throw new Error(`Pascal ${name} arguments contain an oversized array`);
      for (const child of value) queue.push({ value: child, depth: depth + 1, key });
      continue;
    }
    if (value && typeof value === 'object') {
      if (!plainObject(value)) throw new Error(`Pascal ${name} arguments contain a non-plain object`);
      for (const [childKey, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(childKey)) throw new Error(`Pascal ${name} arguments contain a forbidden key`);
        queue.push({ value: child, depth: depth + 1, key: childKey });
      }
    }
  }
  if (name === 'apply_patch' && (!Array.isArray(args.patches) || args.patches.length > 500)) {
    throw new Error('Pascal apply_patch requires at most 500 patches');
  }
  for (const key of ['footprint', 'polygon']) {
    if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].length < 3 || args[key].length > 256
      || args[key].some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) {
      throw new Error(`Pascal ${name} ${key} must contain 3 to 256 finite 2D points`);
    }
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function pathLike(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]/).includes('..');
}
