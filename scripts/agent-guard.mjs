#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const registryPath = path.join(root, "registry", "agents.json");
const skillRegistryPath = path.join(root, "registry", "skills.json");

check("Agent registry exists", fs.existsSync(registryPath), "registry/agents.json");
check("Agent registry schema exists", fs.existsSync(path.join(root, "schemas/personal-agent/agents.schema.json")), "schemas/personal-agent/agents.schema.json");
check("Video style schema exists", fs.existsSync(path.join(root, "schemas/personal-agent/video-styles.schema.json")), "schemas/personal-agent/video-styles.schema.json");
if (!fs.existsSync(registryPath) || !fs.existsSync(skillRegistryPath)) finish();

let registry;
let skillRegistry;
try {
  registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  skillRegistry = JSON.parse(fs.readFileSync(skillRegistryPath, "utf8"));
  check("Agent registry JSON", true, "valid");
} catch (error) {
  check("Agent registry JSON", false, error.message);
  finish();
}

check("Agent registry schema version", registry.schemaVersion === 1, String(registry.schemaVersion));
check("Agent registry is non-empty", Array.isArray(registry.agents) && registry.agents.length > 0, String(registry.agents?.length || 0));
const skillIds = new Set((skillRegistry.skills || []).map((entry) => entry.name));
const agentIds = new Set();
const directories = new Set();

for (const agent of registry.agents || []) {
  const id = String(agent.id || "");
  const directory = String(agent.directory || "");
  const agentRoot = path.join(root, directory);
  check(`Agent id: ${id || "<missing>"}`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), "lowercase hyphen-case required");
  check(`Agent id unique: ${id}`, !agentIds.has(id), id);
  check(`Agent directory: ${id}`, directory === `agents/${id}`, directory);
  check(`Agent directory unique: ${id}`, !directories.has(directory), directory);
  check(`Agent version: ${id}`, Number.isInteger(agent.version) && agent.version >= 1, String(agent.version));
  check(`Agent display name: ${id}`, Boolean(String(agent.displayName || "").trim()), agent.displayName || "missing");
  check(`Agent description: ${id}`, Boolean(String(agent.description || "").trim()), agent.description || "missing");
  const publicProfile = agent.publicProfile;
  check(`Agent public profile: ${id}`, Boolean(publicProfile && typeof publicProfile === "object" && !Array.isArray(publicProfile)), "structured");
  check(`Agent public profile role: ${id}`, validProfileText(publicProfile?.role, 80), publicProfile?.role || "missing");
  check(`Agent public profile tagline: ${id}`, validProfileText(publicProfile?.tagline, 160), publicProfile?.tagline || "missing");
  for (const field of ["capabilities", "inputs", "outputs", "boundaries"]) {
    check(`Agent public profile ${field}: ${id}`, validProfileItems(publicProfile?.[field]), String(publicProfile?.[field]?.length || 0));
  }
  check(`Agent skills: ${id}`, Array.isArray(agent.skills) && agent.skills.length > 0, String(agent.skills?.length || 0));
  check(`Agent skills exist: ${id}`, (agent.skills || []).every((skill) => skillIds.has(skill)), (agent.skills || []).filter((skill) => !skillIds.has(skill)).join(", ") || "all registered");
  check(`Agent routing: ${id}`, Array.isArray(agent.routing) && agent.routing.length > 0 && agent.routing.length <= 32, String(agent.routing?.length || 0));
  check(`Agent routing unique: ${id}`, new Set(agent.routing || []).size === (agent.routing || []).length, "unique");
  check(`Agent routing length: ${id}`, (agent.routing || []).every((term) => String(term).trim().length > 0 && String(term).length <= 80), "1-80 chars");
  check(`Agent directory exists: ${id}`, fs.statSync(agentRoot, { throwIfNoEntry: false })?.isDirectory() === true, directory);
  check(`Agent manifest exists: ${id}`, fs.existsSync(path.join(agentRoot, "agent.yaml")), `${directory}/agent.yaml`);
  check(`Agent instructions exist: ${id}`, agent.instructions === "AGENT.md" && fs.existsSync(path.join(agentRoot, "AGENT.md")), `${directory}/AGENT.md`);
  const hasStyleContract = Boolean(agent.styleGuide || agent.styleCatalog);
  check(`Agent style contract pair: ${id}`, !hasStyleContract || (agent.styleGuide === "STYLE-GUIDE.md" && agent.styleCatalog === "styles.json"), hasStyleContract ? "guide and catalog" : "not declared");
  if (hasStyleContract) {
    check(`Agent style guide exists: ${id}`, fs.existsSync(path.join(agentRoot, "STYLE-GUIDE.md")), `${directory}/STYLE-GUIDE.md`);
    check(`Agent style catalog exists: ${id}`, fs.existsSync(path.join(agentRoot, "styles.json")), `${directory}/styles.json`);
  }

  if (fs.existsSync(path.join(agentRoot, "agent.yaml"))) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(agentRoot, "agent.yaml"), "utf8"));
      check(`Agent manifest schema: ${id}`, manifest.schemaVersion === 1, String(manifest.schemaVersion));
      check(`Agent manifest identity: ${id}`, manifest.id === id && manifest.version === agent.version, `${manifest.id}@${manifest.version}`);
      check(`Agent manifest instructions: ${id}`, manifest.instructions === agent.instructions, manifest.instructions || "missing");
      check(`Agent manifest style guide: ${id}`, manifest.styleGuide === agent.styleGuide, manifest.styleGuide || "not declared");
      check(`Agent manifest style catalog: ${id}`, manifest.styleCatalog === agent.styleCatalog, manifest.styleCatalog || "not declared");
      check(`Agent manifest skills: ${id}`, JSON.stringify(manifest.skills) === JSON.stringify(agent.skills), "matches registry");
      check(`Agent manifest routing: ${id}`, JSON.stringify(manifest.routing) === JSON.stringify(agent.routing), "matches registry");
    } catch (error) {
      check(`Agent manifest JSON-compatible YAML: ${id}`, false, error.message);
    }
  }

  if (fs.existsSync(path.join(agentRoot, "AGENT.md"))) {
    const instructions = fs.readFileSync(path.join(agentRoot, "AGENT.md"), "utf8");
    check(`Agent instructions name profile: ${id}`, instructions.includes(agent.displayName), agent.displayName);
    check(`Agent instructions are bounded: ${id}`, instructions.split(/\r?\n/).length <= 400, `${instructions.split(/\r?\n/).length} lines`);
  }
  if (fs.existsSync(path.join(agentRoot, "styles.json"))) {
    try {
      const catalog = JSON.parse(fs.readFileSync(path.join(agentRoot, "styles.json"), "utf8"));
      const sources = Array.isArray(catalog.researchSources) ? catalog.researchSources : [];
      const sourceIds = sources.map((source) => String(source.id || ""));
      const styles = Array.isArray(catalog.styles) ? catalog.styles : [];
      const styleIds = styles.map((style) => String(style.id || ""));
      check(`Agent style catalog schema: ${id}`, catalog.schemaVersion === 1, String(catalog.schemaVersion));
      check(`Agent style catalog version: ${id}`, /^20\d{2}\.\d{2}$/.test(String(catalog.catalogVersion || "")), catalog.catalogVersion || "missing");
      check(`Agent style research sources: ${id}`, sources.length >= 5 && new Set(sourceIds).size === sourceIds.length, String(sources.length));
      check(`Agent style research URLs: ${id}`, sources.every((source) => /^(https:\/\/|local:)/.test(String(source.url || ""))), "https or governed local reference");
      check(`Agent styles are substantial: ${id}`, styles.length >= 5 && new Set(styleIds).size === styles.length, String(styles.length));
      check(`Agent style ids: ${id}`, styleIds.every((styleId) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(styleId)), "lowercase hyphen-case");
      check(`Agent style default: ${id}`, styleIds.includes(catalog.defaultStyleId), catalog.defaultStyleId || "missing");
      check(`Agent style categories: ${id}`, ["product", "travel"].every((category) => styles.some((style) => style.category === category)), "product and travel");
      check(`Agent style selection policy: ${id}`, catalog.selectionPolicy?.primaryRequired === true && catalog.selectionPolicy?.secondaryOptional === true && Number(catalog.selectionPolicy?.maxSecondarySharePercent) <= 30, "bounded primary/secondary selection");
      check(`Agent style contracts: ${id}`, styles.every((style) => (
        Number.isInteger(style.version)
        && style.version >= 1
        && ["product", "travel", "hybrid"].includes(style.category)
        && Array.isArray(style.useWhen)
        && style.useWhen.length > 0
        && Array.isArray(style.avoidWhen)
        && style.avoidWhen.length > 0
        && ["narrative", "visual", "motion", "audio", "format"].every((section) => style[section] && typeof style[section] === "object")
        && Array.isArray(style.acceptance)
        && style.acceptance.length >= 3
      )), "narrative, visual, motion, audio, format and acceptance");
      check(`Agent style source references: ${id}`, styles.every((style) => (
        Array.isArray(style.referenceBasis)
        && style.referenceBasis.length > 0
        && style.referenceBasis.every((sourceId) => sourceIds.includes(sourceId))
      )), "all style sources are registered");
      if (fs.existsSync(path.join(agentRoot, "STYLE-GUIDE.md"))) {
        const guide = fs.readFileSync(path.join(agentRoot, "STYLE-GUIDE.md"), "utf8");
        check(`Agent style guide covers catalog: ${id}`, styleIds.every((styleId) => guide.includes(styleId)), `${styleIds.length} style ids`);
      }
    } catch (error) {
      check(`Agent style catalog JSON: ${id}`, false, error.message);
    }
  }
  agentIds.add(id);
  directories.add(directory);
}

const diskAgents = fs.existsSync(path.join(root, "agents"))
  ? fs.readdirSync(path.join(root, "agents"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
  : [];
for (const id of diskAgents) check(`Agent registered: ${id}`, agentIds.has(id), "registry/agents.json");
for (const id of agentIds) check(`Registered Agent directory: ${id}`, diskAgents.includes(id), `agents/${id}`);

finish();

function validProfileText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validProfileItems(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 8
    && new Set(value).size === value.length
    && value.every((item) => validProfileText(item, 160));
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: String(detail || "") });
}

function finish() {
  for (const item of checks) process.stdout.write(`${item.ok ? "PASS" : "FAIL"}: ${item.name}${item.detail ? ` (${item.detail})` : ""}\n`);
  const failures = checks.filter((item) => !item.ok);
  if (failures.length) process.exit(1);
  process.stdout.write("Agent guard completed successfully.\n");
  process.exit(0);
}
