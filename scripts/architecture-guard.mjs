#!/usr/bin/env node
import { exists, readJson, report } from './harness-lib.mjs';

const checks = [];
const projects = readJson('registry/projects.json');
const capabilities = readJson('registry/capabilities.json');
const routes = readJson('registry/routes.json');
const extensions = readJson('registry/extensions.json');
const commands = readJson('registry/commands.json');
const projectNames = new Set(projects.projects.map((entry) => entry.name));
const capabilityIds = new Set(capabilities.capabilities.map((entry) => entry.id));

checks.push({ name: 'only Node and Edge are registered products', ok: projectNames.size === 2 && projectNames.has('personal-agent-node') && projectNames.has('private-site-edge') });
checks.push({ name: 'project registry has target schema version', ok: projects.schemaVersion === 2 });
for (const file of ['capabilities', 'routes', 'extensions', 'commands']) {
  checks.push({ name: `${file} registry`, ok: exists(`registry/${file}.json`) });
  checks.push({ name: `${file} schema`, ok: exists(`schemas/personal-agent/${file}.schema.json`) });
}
checks.push({ name: 'capability ids are unique', ok: capabilityIds.size === capabilities.capabilities.length });
checks.push({ name: 'capabilities have registered owners', ok: capabilities.capabilities.every((entry) => projectNames.has(entry.owner)) });
checks.push({ name: 'route policy defaults to deny', ok: routes.defaultPolicy === 'deny' });
checks.push({ name: 'route patterns are unique', ok: new Set(routes.routes.map((entry) => entry.pattern)).size === routes.routes.length });
checks.push({ name: 'routes reference capabilities', ok: routes.routes.every((entry) => capabilityIds.has(entry.capability)) });
checks.push({ name: 'local administration routes are explicit', ok: ['/api/system/*', '/api/extensions/*'].every((pattern) => routes.routes.some((entry) => entry.pattern === pattern && entry.access === 'local-admin')) });
checks.push({ name: 'extension ids are unique', ok: new Set(extensions.extensions.map((entry) => entry.id)).size === extensions.extensions.length });
checks.push({ name: 'extensions declare permissions', ok: extensions.extensions.every((entry) => Array.isArray(entry.permissions) && entry.permissions.length > 0) });
checks.push({ name: 'unified CLI is partially implemented', ok: commands.binary === 'personal-agent' && commands.implementationStatus === 'partial' && exists('projects/core/node/bin/personal-agent.mjs') });
checks.push({ name: 'command names are unique', ok: new Set(commands.commands.map((entry) => entry.name)).size === commands.commands.length });
checks.push({ name: 'commands reference capabilities', ok: commands.commands.every((entry) => capabilityIds.has(entry.capability)) });
checks.push({ name: 'commands declare R0-R3 risk', ok: commands.commands.every((entry) => /^R[0-3]$/.test(entry.risk)) });
checks.push({ name: 'agent output contract is JSON', ok: commands.output?.agentFormat === 'json' && commands.output?.formats?.includes('json') });
checks.push({ name: 'personal-agent skill', ok: exists('skills/personal-agent/SKILL.md') });
checks.push({ name: 'legacy bridge skill removed', ok: !exists('skills/open-agent-bridge/SKILL.md') });
report(checks);
