#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSpecialistWorkflow } from "../core/agent/src/agents/workflow.js";

const scriptFile = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptFile), "..");
const ID_PATTERN = /^[a-z][a-z0-9-]{2,47}$/;
const SKILL_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const EXAMPLE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const PROFILE_KEYS = [
  "schemaVersion", "overview", "skillSummaries", "capabilities", "useWhen", "notFor",
  "requiredInputs", "workflow", "deliverables", "examples", "limitations", "acceptance",
  "visualIdentity",
];
const PUBLIC_TEXT_PATTERNS = [
  ["file URL", /\bfile:\/\//i],
  ["loopback address", /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/i],
  ["Windows absolute path", /(?:^|[\s"'(])[A-Za-z]:[\\/]/],
  ["Unix absolute path", /(?:^|[\s"'(])\/(?:home|Users|root|var|etc|tmp|opt|srv|private)(?:\/|\\)/],
  ["remote URL", /\bhttps?:\/\//i],
  ["untrusted HTML", /<\s*\/?\s*[a-z][^>]*>/i],
  ["path traversal", /(?:^|[\\/])\.\.(?:[\\/]|$)/],
  ["internal or credential text", /\b(?:secret|password|api[_ -]?key|access[_ -]?token|system prompt|developer instructions)\b|(?:密钥|口令|密码|系统提示|内部提示)/i],
];

export function validateAgentRegistry({ rootDir = defaultRoot } = {}) {
  const root = path.resolve(rootDir);
  const agentsRoot = path.join(root, "agents");
  const errors = [];
  const registry = readStructured(path.join(root, "registry", "agents.json"), "Agent registry", errors);
  const skillRegistry = readStructured(path.join(root, "registry", "skills.json"), "Skill registry", errors);
  const agentsSchema = readStructured(path.join(root, "schemas", "personal-agent", "agents.schema.json"), "Agent schema", errors);
  const profileSchema = readStructured(path.join(root, "schemas", "personal-agent", "agent-profile.schema.json"), "Agent profile schema", errors);
  const workflowSchema = readStructured(path.join(root, "schemas", "personal-agent", "agent-workflow.schema.json"), "Agent workflow schema", errors);
  if (!registry || !skillRegistry || !agentsSchema || !profileSchema || !workflowSchema) return result(errors, 0);

  if (agentsSchema.$id !== "https://personal-agent.cn/schemas/agents-v1.json") {
    errors.push("Agent schema has an unsupported $id");
  }
  if (profileSchema.$id !== "https://personal-agent.cn/schemas/agent-profile-v1.json") {
    errors.push("Agent profile schema has an unsupported $id");
  }
  if (workflowSchema.$id !== "https://personal-agent.cn/schemas/agent-workflow-v2.json") {
    errors.push("Agent workflow schema has an unsupported $id");
  }
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.agents)) {
    errors.push("Agent registry must use schemaVersion 1 and contain an agents array");
    return result(errors, 0);
  }
  if (registry.agents.length < 1 || registry.agents.length > 32) {
    errors.push("Agent registry must contain between 1 and 32 Agents");
  }

  const knownSkills = new Set(Array.isArray(skillRegistry.skills)
    ? skillRegistry.skills.map((entry) => String(entry?.name || "")).filter(Boolean)
    : []);
  const ids = new Set();
  const directories = new Set();
  const displayNames = new Set();
  const routeIdentities = new Map();

  for (const [index, entry] of registry.agents.entries()) {
    const label = `registry.agents[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    exactKeys(entry, ["id", "directory", "config"], label, errors);
    const id = requiredText(entry.id, `${label}.id`, 3, 48, errors);
    if (id && !ID_PATTERN.test(id)) errors.push(`${label}.id is invalid: ${id}`);
    if (id && ids.has(id)) errors.push(`duplicate Agent id: ${id}`);
    if (id) ids.add(id);

    const directory = requiredText(entry.directory, `${label}.directory`, 8, 64, errors);
    if (directory && directories.has(directory)) errors.push(`duplicate Agent directory: ${directory}`);
    if (directory) directories.add(directory);
    if (directory && id && directory !== `agents/${id}`) {
      errors.push(`${label}.directory must be agents/${id}`);
    }
    if (entry.config !== "agent.yaml") errors.push(`${label}.config must be agent.yaml`);

    const agentDirectory = safePath(agentsRoot, root, directory, `${label}.directory`, errors);
    if (!agentDirectory || !directoryExists(agentDirectory, `${label}.directory`, errors)) continue;
    const configPath = safePath(agentDirectory, agentDirectory, entry.config, `${label}.config`, errors);
    if (!configPath) continue;
    const config = readStructured(configPath, `${id || label} agent.yaml`, errors);
    if (!config) continue;
    validateAgentConfig(config, {
      id,
      agentDirectory,
      knownSkills,
      displayNames,
      routeIdentities,
      errors,
    });
  }

  return result(errors, registry.agents.length);
}

function validateAgentConfig(config, context) {
  const { id, agentDirectory, knownSkills, displayNames, routeIdentities, errors } = context;
  const label = `${id || path.basename(agentDirectory)} agent.yaml`;
  if (!isRecord(config)) {
    errors.push(`${label} must be an object`);
    return;
  }
  exactKeys(config, [
    "schemaVersion", "id", "version", "displayName", "description", "instructions",
    "profile", "workflow", "skills", "routing",
  ], label, errors);
  if (config.schemaVersion !== 1) errors.push(`${label} has an unsupported schemaVersion`);
  if (config.id !== id) errors.push(`${label} id does not match registry id ${id}`);
  if (!Number.isInteger(config.version) || config.version < 1 || config.version > 100000) {
    errors.push(`${label}.version must be an integer between 1 and 100000`);
  }
  const displayName = requiredText(config.displayName, `${label}.displayName`, 2, 40, errors);
  requiredText(config.description, `${label}.description`, 10, 180, errors);
  if (displayName && displayNames.has(displayName)) errors.push(`duplicate Agent displayName: ${displayName}`);
  if (displayName) displayNames.add(displayName);
  if (config.instructions !== "AGENT.md") errors.push(`${label}.instructions must be AGENT.md`);
  if (config.profile !== "profile.yaml") errors.push(`${label}.profile must be profile.yaml`);
  if (config.workflow !== "workflow.json") errors.push(`${label}.workflow must be workflow.json`);

  const instructionsPath = safePath(agentDirectory, agentDirectory, config.instructions, `${label}.instructions`, errors);
  const profilePath = safePath(agentDirectory, agentDirectory, config.profile, `${label}.profile`, errors);
  const workflowPath = safePath(agentDirectory, agentDirectory, config.workflow, `${label}.workflow`, errors);
  if (instructionsPath) {
    if (!regularFile(instructionsPath, `${label}.instructions`, errors)) {
      // regularFile records the failure.
    } else {
      const instructions = fs.readFileSync(instructionsPath, "utf8").trim();
      if (instructions.length < 200 || instructions.length > 30000) {
        errors.push(`${label}.instructions must contain between 200 and 30000 characters`);
      }
    }
  }

  const skills = stringArray(config.skills, `${label}.skills`, 1, 12, 2, 64, errors);
  for (const skill of skills) {
    if (!SKILL_PATTERN.test(skill)) errors.push(`${label} contains invalid Skill id: ${skill}`);
    else if (!knownSkills.has(skill)) errors.push(`${label} references unknown Skill: ${skill}`);
  }

  if (!isRecord(config.routing)) {
    errors.push(`${label}.routing must be an object`);
  } else {
    exactKeys(config.routing, ["domains", "summary"], `${label}.routing`, errors);
    const domains = stringArray(config.routing.domains, `${label}.routing.domains`, 2, 12, 2, 60, errors);
    requiredText(config.routing.summary, `${label}.routing.summary`, 10, 200, errors);
    for (const domain of domains) {
      const identity = domain.trim().toLocaleLowerCase("en-US");
      const previous = routeIdentities.get(identity);
      if (previous && previous !== id) errors.push(`duplicate Agent routing identity "${domain}" in ${previous} and ${id}`);
      else routeIdentities.set(identity, id);
    }
  }

  scanPublicText({
    displayName: config.displayName,
    description: config.description,
    routing: config.routing,
  }, `${label} public fields`, errors);

  if (profilePath && regularFile(profilePath, `${label}.profile`, errors)) {
    const profile = readStructured(profilePath, `${id} profile.yaml`, errors);
    if (profile) validateProfile(profile, { id, agentDirectory, configuredSkills: skills, errors });
  }
  if (workflowPath && regularFile(workflowPath, `${label}.workflow`, errors)) {
    const workflow = readStructured(workflowPath, `${id} workflow.json`, errors);
    if (workflow) {
      const validation = validateSpecialistWorkflow(workflow, { agentId: id });
      for (const error of validation.errors) errors.push(`${id} workflow.json: ${error}`);
      scanPublicText(workflow, `${id} workflow.json`, errors);
    }
  }
}

function validateProfile(profile, { id, agentDirectory, configuredSkills, errors }) {
  const label = `${id} profile.yaml`;
  if (!isRecord(profile)) {
    errors.push(`${label} must be an object`);
    return;
  }
  exactKeys(profile, PROFILE_KEYS, label, errors);
  if (profile.schemaVersion !== 1) errors.push(`${label} has an unsupported schemaVersion`);

  if (!isRecord(profile.overview)) {
    errors.push(`${label}.overview must be an object`);
  } else {
    exactKeys(profile.overview, ["role", "tagline"], `${label}.overview`, errors);
    requiredText(profile.overview.role, `${label}.overview.role`, 4, 60, errors);
    requiredText(profile.overview.tagline, `${label}.overview.tagline`, 12, 160, errors);
  }

  const skillSummaries = objectArray(profile.skillSummaries, `${label}.skillSummaries`, 1, 12, errors);
  const publicSkillIds = new Set();
  for (const [index, item] of skillSummaries.entries()) {
    const itemLabel = `${label}.skillSummaries[${index}]`;
    exactKeys(item, ["id", "label", "summary"], itemLabel, errors);
    const skillId = requiredText(item.id, `${itemLabel}.id`, 2, 64, errors);
    if (skillId && publicSkillIds.has(skillId)) errors.push(`${label} has duplicate Skill summary: ${skillId}`);
    if (skillId) publicSkillIds.add(skillId);
    requiredText(item.label, `${itemLabel}.label`, 2, 60, errors);
    requiredText(item.summary, `${itemLabel}.summary`, 8, 160, errors);
  }
  if (!sameSet(publicSkillIds, new Set(configuredSkills))) {
    errors.push(`${label}.skillSummaries must describe exactly the Skills declared by agent.yaml`);
  }

  validateTitledDescriptions(profile.capabilities, `${label}.capabilities`, 3, 8, errors);
  validatePublicList(profile.useWhen, `${label}.useWhen`, errors);
  validatePublicList(profile.notFor, `${label}.notFor`, errors);
  validatePublicList(profile.requiredInputs, `${label}.requiredInputs`, errors);
  validateWorkflowDescriptions(profile.workflow, `${label}.workflow`, errors);

  const deliverables = objectArray(profile.deliverables, `${label}.deliverables`, 2, 8, errors);
  for (const [index, item] of deliverables.entries()) {
    const itemLabel = `${label}.deliverables[${index}]`;
    exactKeys(item, ["kind", "title", "description"], itemLabel, errors);
    requiredText(item.kind, `${itemLabel}.kind`, 2, 40, errors);
    requiredText(item.title, `${itemLabel}.title`, 2, 80, errors);
    requiredText(item.description, `${itemLabel}.description`, 8, 200, errors);
  }

  const examples = objectArray(profile.examples, `${label}.examples`, 1, 4, errors);
  const exampleIds = new Set();
  for (const [index, item] of examples.entries()) {
    const itemLabel = `${label}.examples[${index}]`;
    exactKeys(item, ["id", "title", "kind", "summary", "metadata"], itemLabel, errors);
    const exampleId = requiredText(item.id, `${itemLabel}.id`, 3, 64, errors);
    if (exampleId && !EXAMPLE_ID_PATTERN.test(exampleId)) errors.push(`${itemLabel}.id is invalid`);
    if (exampleId && exampleIds.has(exampleId)) errors.push(`${label} has duplicate example id: ${exampleId}`);
    if (exampleId) exampleIds.add(exampleId);
    requiredText(item.title, `${itemLabel}.title`, 2, 80, errors);
    requiredText(item.kind, `${itemLabel}.kind`, 2, 40, errors);
    requiredText(item.summary, `${itemLabel}.summary`, 8, 200, errors);
    const metadata = requiredText(item.metadata, `${itemLabel}.metadata`, 8, 110, errors);
    const metadataPath = safePath(agentDirectory, agentDirectory, metadata, `${itemLabel}.metadata`, errors);
    if (metadataPath && regularFile(metadataPath, `${itemLabel}.metadata`, errors)) {
      const example = readStructured(metadataPath, `${id} example metadata`, errors);
      if (example) validateExampleMetadata(example, { exampleId, label: `${id} example metadata`, errors });
    }
  }

  validatePublicList(profile.limitations, `${label}.limitations`, errors);
  validatePublicList(profile.acceptance, `${label}.acceptance`, errors);
  if (!isRecord(profile.visualIdentity)) {
    errors.push(`${label}.visualIdentity must be an object`);
  } else {
    exactKeys(profile.visualIdentity, ["accent", "icon", "tone"], `${label}.visualIdentity`, errors);
    const accent = requiredText(profile.visualIdentity.accent, `${label}.visualIdentity.accent`, 7, 7, errors);
    if (accent && !/^#[0-9A-Fa-f]{6}$/.test(accent)) errors.push(`${label}.visualIdentity.accent must be a six-digit hex color`);
    const icon = requiredText(profile.visualIdentity.icon, `${label}.visualIdentity.icon`, 2, 40, errors);
    if (icon && !/^[A-Za-z][A-Za-z0-9]{1,39}$/.test(icon)) errors.push(`${label}.visualIdentity.icon is invalid`);
    requiredText(profile.visualIdentity.tone, `${label}.visualIdentity.tone`, 4, 80, errors);
  }

  scanPublicText(profile, label, errors);
}

function validateExampleMetadata(example, { exampleId, label, errors }) {
  if (!isRecord(example)) {
    errors.push(`${label} must be an object`);
    return;
  }
  exactKeys(example, [
    "schemaVersion", "id", "source", "kind", "title", "summary", "sanitized", "verified", "presentation",
  ], label, errors);
  if (example.schemaVersion !== 1) errors.push(`${label} has an unsupported schemaVersion`);
  if (example.id !== exampleId) errors.push(`${label} id does not match profile example ${exampleId}`);
  if (example.source !== "product-example") errors.push(`${label}.source must be product-example`);
  requiredText(example.kind, `${label}.kind`, 3, 40, errors);
  requiredText(example.title, `${label}.title`, 2, 80, errors);
  requiredText(example.summary, `${label}.summary`, 8, 240, errors);
  if (example.sanitized !== true) errors.push(`${label} must declare sanitized: true`);
  if (example.verified !== true) errors.push(`${label} must declare verified: true`);
  if (!isRecord(example.presentation)) {
    errors.push(`${label}.presentation must be an object`);
  } else {
    exactKeys(example.presentation, ["devices", "primaryView"], `${label}.presentation`, errors);
    const devices = stringArray(example.presentation.devices, `${label}.presentation.devices`, 1, 3, 6, 24, errors);
    const allowedDevices = new Set(["desktop", "mobile", "mobile-landscape"]);
    for (const device of devices) if (!allowedDevices.has(device)) errors.push(`${label} has unsupported device: ${device}`);
    if (!devices.includes(example.presentation.primaryView)) errors.push(`${label}.presentation.primaryView must be one of its devices`);
  }
  scanPublicText(example, label, errors);
}

function validateTitledDescriptions(value, label, minimum, maximum, errors) {
  const items = objectArray(value, label, minimum, maximum, errors);
  for (const [index, item] of items.entries()) {
    const itemLabel = `${label}[${index}]`;
    exactKeys(item, ["title", "description"], itemLabel, errors);
    requiredText(item.title, `${itemLabel}.title`, 2, 60, errors);
    requiredText(item.description, `${itemLabel}.description`, 8, 200, errors);
  }
}

function validateWorkflowDescriptions(value, label, errors) {
  const items = objectArray(value, label, 3, 8, errors);
  for (const [index, item] of items.entries()) {
    const itemLabel = `${label}[${index}]`;
    exactKeys(item, ["title", "description", "surface"], itemLabel, errors);
    requiredText(item.title, `${itemLabel}.title`, 2, 60, errors);
    requiredText(item.description, `${itemLabel}.description`, 8, 200, errors);
    if (!["text", "page", "terminal"].includes(item.surface)) errors.push(`${itemLabel}.surface is invalid`);
  }
}

function validatePublicList(value, label, errors) {
  stringArray(value, label, 2, 8, 4, 180, errors);
}

function stringArray(value, label, minimum, maximum, textMinimum, textMaximum, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  if (value.length < minimum || value.length > maximum) {
    errors.push(`${label} must contain between ${minimum} and ${maximum} items`);
  }
  const output = [];
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const text = requiredText(item, `${label}[${index}]`, textMinimum, textMaximum, errors);
    if (!text) continue;
    if (seen.has(text)) errors.push(`${label} contains a duplicate item: ${text}`);
    seen.add(text);
    output.push(text);
  }
  return output;
}

function objectArray(value, label, minimum, maximum, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  if (value.length < minimum || value.length > maximum) {
    errors.push(`${label} must contain between ${minimum} and ${maximum} items`);
  }
  const output = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) errors.push(`${label}[${index}] must be an object`);
    else output.push(item);
  }
  return output;
}

function requiredText(value, label, minimum, maximum, errors) {
  if (typeof value !== "string" || value.trim() !== value || value.length < minimum || value.length > maximum) {
    errors.push(`${label} must be trimmed text between ${minimum} and ${maximum} characters`);
    return "";
  }
  return value;
}

function exactKeys(value, allowed, label, errors) {
  const expected = new Set(allowed);
  for (const key of allowed) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${label} contains unsupported field ${key}`);
}

function safePath(containmentRoot, resolutionRoot, relative, label, errors) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\0")) {
    errors.push(`${label} must be a safe relative path`);
    return "";
  }
  const parts = relative.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    errors.push(`${label} contains path traversal`);
    return "";
  }
  const resolved = path.resolve(resolutionRoot, ...parts);
  const boundary = `${path.resolve(containmentRoot)}${path.sep}`;
  if (resolved !== path.resolve(containmentRoot) && !resolved.startsWith(boundary)) {
    errors.push(`${label} escapes its allowed directory`);
    return "";
  }
  const containmentStat = fs.statSync(containmentRoot, { throwIfNoEntry: false });
  const resolvedStat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (containmentStat && resolvedStat) {
    const realContainment = fs.realpathSync(containmentRoot);
    const realResolved = fs.realpathSync(resolved);
    const realBoundary = `${realContainment}${path.sep}`;
    if (realResolved !== realContainment && !realResolved.startsWith(realBoundary)) {
      errors.push(`${label} escapes its allowed directory through a symbolic link`);
      return "";
    }
  }
  return resolved;
}

function directoryExists(directory, label, errors) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    errors.push(`${label} must reference a real directory`);
    return false;
  }
  return true;
}

function regularFile(file, label, errors) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    errors.push(`${label} must reference a real file`);
    return false;
  }
  return true;
}

function scanPublicText(value, label, errors, pointer = "") {
  if (typeof value === "string") {
    for (const [kind, pattern] of PUBLIC_TEXT_PATTERNS) {
      if (pattern.test(value)) errors.push(`${label}${pointer} contains forbidden ${kind}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPublicText(item, label, errors, `${pointer}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) scanPublicText(item, label, errors, `${pointer}.${key}`);
  }
}

function readStructured(file, label, errors) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    errors.push(`${label} is missing or is not a regular file: ${file}`);
    return null;
  }
  try {
    // JSON documents are valid YAML 1.2, keeping installed parsing dependency-free.
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(value)) throw new Error("top-level value must be an object");
    return value;
  } catch (error) {
    errors.push(`${label} must be valid JSON-compatible YAML: ${error.message}`);
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function result(errors, agentCount) {
  return { ok: errors.length === 0, errors, agentCount };
}

function commandRoot(argv) {
  const index = argv.indexOf("--root");
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : defaultRoot;
}

function run() {
  const validation = validateAgentRegistry({ rootDir: commandRoot(process.argv.slice(2)) });
  if (validation.ok) {
    console.log(`[OK] specialist Agent registry: ${validation.agentCount} Agents`);
    console.log("OK: Agent source contract is valid");
    return;
  }
  for (const error of validation.errors) console.error(`[FAIL] ${error}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) run();
