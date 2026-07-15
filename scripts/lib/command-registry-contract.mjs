import fs from 'node:fs';

const HANDLED_COMMAND_KEYS = Object.freeze(JSON.parse(fs.readFileSync(new URL('../../core/runtime/contracts/handled-commands.json', import.meta.url), 'utf8')).commands);

function expandCommandName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts;
  if (parts.length !== 2) throw new Error(`Invalid command group: ${name}`);
  return parts[1].split('|').map((action) => `${parts[0]} ${action}`);
}

const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*(?:\|[a-z][a-z0-9-]*)*)?$/;
const STATUSES = Object.freeze(['implemented', 'preview', 'planned']);
const TOP_LEVEL_FIELDS = Object.freeze(['binary', 'commands', 'implementationStatus', 'implementationStatuses', 'output', 'schemaVersion']);
const OUTPUT_FIELDS = Object.freeze(['agentFormat', 'formats', 'schemaVersion']);
const COMMAND_FIELDS = Object.freeze(['capability', 'description', 'implementationStatus', 'name', 'risk']);

export function validateCommandRegistry({ registry, schema, capabilityIds, handledCommandKeys = HANDLED_COMMAND_KEYS }) {
  const errors = validateCommandSchemaContract(schema);
  if (!isObject(registry)) return failure([...errors, 'registry must be an object']);

  if (!sameMembers(Object.keys(registry), TOP_LEVEL_FIELDS)) errors.push(`registry must contain only ${TOP_LEVEL_FIELDS.join(', ')}`);
  if (registry.schemaVersion !== 2) errors.push('registry.schemaVersion must be 2');
  if (registry.binary !== 'personal-agent') errors.push('registry.binary must be personal-agent');
  if (!['planned', 'partial', 'implemented'].includes(registry.implementationStatus)) errors.push('registry.implementationStatus is invalid');
  validateStatuses(registry.implementationStatuses, errors);
  if (!isObject(registry.output)
    || !sameMembers(Object.keys(registry.output), OUTPUT_FIELDS)
    || !Number.isInteger(registry.output.schemaVersion)
    || registry.output.schemaVersion < 1
    || !Array.isArray(registry.output.formats)
    || registry.output.formats.length !== 1
    || registry.output.formats[0] !== 'json'
    || new Set(registry.output.formats).size !== registry.output.formats.length
    || registry.output.agentFormat !== 'json') errors.push('registry.output must declare JSON as the only implemented format and Agent output');
  if (!Array.isArray(registry.commands)) return failure([...errors, 'registry.commands must be an array']);

  const expanded = [];
  for (const [index, command] of registry.commands.entries()) {
    const location = `registry.commands[${index}]`;
    if (!isObject(command)) {
      errors.push(`${location} must be an object`);
      continue;
    }
    if (!sameMembers(Object.keys(command), COMMAND_FIELDS)) errors.push(`${location} must contain only ${COMMAND_FIELDS.join(', ')}`);
    if (typeof command.name !== 'string' || !COMMAND_NAME_PATTERN.test(command.name)) errors.push(`${location}.name is invalid`);
    if (!/^R[0-3]$/.test(command.risk || '')) errors.push(`${location}.risk is invalid`);
    if (!STATUSES.includes(command.implementationStatus)) errors.push(`${location}.implementationStatus is invalid`);
    if (typeof command.description !== 'string' || command.description.trim() === '') errors.push(`${location}.description is required`);
    if (typeof command.capability !== 'string' || (capabilityIds && !capabilityIds.has(command.capability))) errors.push(`${location}.capability is unknown`);
    if (typeof command.name === 'string' && COMMAND_NAME_PATTERN.test(command.name)) {
      for (const name of expandCommandName(command.name)) expanded.push({ name, status: command.implementationStatus });
    }
  }

  const expandedNames = expanded.map((entry) => entry.name);
  if (new Set(expandedNames).size !== expandedNames.length) errors.push('expanded command leaves must be unique');
  const declaredHandled = expanded.filter((entry) => ['implemented', 'preview'].includes(entry.status)).map((entry) => entry.name).sort();
  const actualHandled = [...handledCommandKeys].sort();
  if (!sameOrdered(declaredHandled, actualHandled)) errors.push(`handled command leaves differ: registry=${declaredHandled.join('|')} handlers=${actualHandled.join('|')}`);
  if (!expanded.some((entry) => entry.name === 'help' && entry.status === 'implemented')) errors.push('help must be registered as implemented');

  return failure(errors);
}

export function validateCommandSchemaContract(schema) {
  const errors = [];
  if (!isObject(schema)) return ['commands schema must be an object'];
  if (schema.additionalProperties !== false) errors.push('commands schema must reject extra top-level fields');
  if (schema.properties?.schemaVersion?.const !== 2) errors.push('commands schema must require schemaVersion 2');
  if (schema.properties?.output?.additionalProperties !== false) errors.push('commands schema must reject extra output fields');
  if (JSON.stringify(schema.properties?.output?.properties?.formats?.const) !== JSON.stringify(['json'])) errors.push('commands schema must expose JSON as the only implemented output format');
  if (!sameMembers(schema.properties?.implementationStatuses?.required || [], STATUSES)) errors.push('commands schema must require implemented, preview, and planned statuses');
  if (!sameMembers(schema.$defs?.command?.properties?.implementationStatus?.enum || [], STATUSES)) errors.push('commands schema command status enum is invalid');
  if (schema.$defs?.command?.properties?.name?.pattern !== COMMAND_NAME_PATTERN.source) errors.push('commands schema command-name pattern is invalid');
  if (!sameMembers(schema.$defs?.command?.required || [], COMMAND_FIELDS)) errors.push('commands schema command fields are invalid');
  if (schema.$defs?.command?.additionalProperties !== false) errors.push('commands schema must reject extra command fields');
  if (schema.$defs?.implementedStatus?.properties?.requiresPreviewFlag?.const !== false
    || schema.$defs?.previewStatus?.properties?.requiresPreviewFlag?.const !== true
    || schema.$defs?.plannedStatus?.properties?.executable?.const !== false) errors.push('commands schema status gates are invalid');
  return errors;
}

function validateStatuses(statuses, errors) {
  if (!isObject(statuses) || !sameMembers(Object.keys(statuses), STATUSES)) {
    errors.push('registry.implementationStatuses must contain only implemented, preview, and planned');
    return;
  }
  const expected = {
    implemented: { executable: true, requiresPreviewFlag: false },
    preview: { executable: true, requiresPreviewFlag: true },
    planned: { executable: false, requiresPreviewFlag: false },
  };
  for (const status of STATUSES) {
    const value = statuses[status];
    if (!isObject(value)
      || !sameMembers(Object.keys(value), ['description', 'executable', 'requiresPreviewFlag'])
      || value.executable !== expected[status].executable
      || value.requiresPreviewFlag !== expected[status].requiresPreviewFlag
      || typeof value.description !== 'string'
      || value.description.trim() === '') errors.push(`registry.implementationStatuses.${status} is invalid`);
  }
}

function failure(errors) {
  return { ok: errors.length === 0, errors };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameMembers(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sameOrdered(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
