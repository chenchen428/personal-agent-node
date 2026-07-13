#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { exists, readJson, report, root } from './harness-lib.mjs';
import { validateCommandRegistry } from './lib/command-registry-contract.mjs';

const checks = [];
const projects = readJson('registry/projects.json');
const capabilities = readJson('registry/capabilities.json');
const routes = readJson('registry/routes.json');
const extensions = readJson('registry/extensions.json');
const commands = readJson('registry/commands.json');
const commandsSchema = readJson('schemas/personal-agent/commands.schema.json');
const distribution = readJson('registry/site-distribution.json');
const projectNames = new Set(projects.projects.map((entry) => entry.name));
const capabilityIds = new Set(capabilities.capabilities.map((entry) => entry.id));
const commandStatuses = commands.implementationStatuses || {};
const commandContract = validateCommandRegistry({ registry: commands, schema: commandsSchema, capabilityIds });

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
checks.push({ name: 'distribution is path-only and deny-by-default', ok: distribution.routing?.defaultMode === 'path' && distribution.routing?.defaultPolicy === 'deny' && (distribution.domain?.legacyHosts || []).length === 0 });
checks.push({ name: 'distribution exposes only unified private routes', ok: distribution.routing.paths.every((entry) => !['/admin', '/agent', '/api/agent', '/api/files'].some((legacy) => entry.prefix === legacy || entry.prefix.startsWith(`${legacy}/`))) });
checks.push({ name: 'unified console is mounted', ok: distribution.routing.paths.some((entry) => entry.prefix === '/app' && entry.access === 'authenticated') });
checks.push({ name: 'extension ids are unique', ok: new Set(extensions.extensions.map((entry) => entry.id)).size === extensions.extensions.length });
checks.push({ name: 'extensions declare permissions', ok: extensions.extensions.every((entry) => Array.isArray(entry.permissions) && entry.permissions.length > 0) });
checks.push({ name: 'unified CLI is partially implemented', ok: commands.schemaVersion === 2 && commands.binary === 'personal-agent' && commands.implementationStatus === 'partial' && exists('projects/core/node/bin/personal-agent.mjs') });
checks.push({ name: 'command registry satisfies the self-contained public contract', ok: commandContract.ok });
checks.push({
  name: 'command implementation statuses are explicit',
  ok: commandStatuses.implemented?.executable === true
    && commandStatuses.implemented?.requiresPreviewFlag === false
    && commandStatuses.preview?.executable === true
    && commandStatuses.preview?.requiresPreviewFlag === true
    && commandStatuses.planned?.executable === false
    && commandStatuses.planned?.requiresPreviewFlag === false
    && Object.keys(commandStatuses).sort().join(',') === 'implemented,planned,preview',
});
checks.push({
  name: 'commands declare known implementation status and description',
  ok: commands.commands.every((entry) => commandStatuses[entry.implementationStatus]
    && typeof entry.description === 'string'
    && entry.description.trim().length > 0),
});
checks.push({ name: 'commands reference capabilities', ok: commands.commands.every((entry) => capabilityIds.has(entry.capability)) });
checks.push({ name: 'commands declare R0-R3 risk', ok: commands.commands.every((entry) => /^R[0-3]$/.test(entry.risk)) });
checks.push({ name: 'agent output contract is JSON', ok: commands.output?.agentFormat === 'json' && commands.output?.formats?.includes('json') });
checks.push({ name: 'personal-agent skill', ok: exists('skills/personal-agent/SKILL.md') });
checks.push({ name: 'legacy bridge skill removed', ok: !exists('skills/open-agent-bridge/SKILL.md') });
const cloudEnrollmentSource = fs.readFileSync(path.join(root, 'projects/core/node/src/cloud-enrollment.mjs'), 'utf8');
checks.push({ name: 'legacy invitation onboarding removed', ok: !exists('projects/core/node/src/onboarding-server.mjs') && !cloudEnrollmentSource.includes('enrollWithCloud(') && !cloudEnrollmentSource.includes('/activate') });
report(checks);
