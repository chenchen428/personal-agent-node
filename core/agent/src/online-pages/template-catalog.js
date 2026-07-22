import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRegistryPath = resolvePageTemplateRegistryPath();

export function resolvePageTemplateRegistryPath(moduleFile = fileURLToPath(import.meta.url)) {
  let directory = path.dirname(path.resolve(moduleFile));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(directory, "registry", "page-templates.json");
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("Page template registry is missing from the release root");
}

export function readPageTemplateRegistry(registryPath = defaultRegistryPath) {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.templates)) {
    throw new Error("unsupported Page template registry");
  }
  const ids = new Set();
  for (const template of parsed.templates) {
    const id = String(template?.id || "");
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error("invalid or duplicate Page template id");
    if (!template.name || !template.category || !template.skill || !template.summary || template.status !== "built-in") {
      throw new Error(`incomplete Page template contract: ${id}`);
    }
    for (const field of ["matchTerms", "fixedFramework", "agentFreedom", "agentInstructions"]) {
      if (!Array.isArray(template[field]) || template[field].length === 0 || template[field].some((item) => !String(item || "").trim())) {
        throw new Error(`invalid Page template ${field}: ${id}`);
      }
    }
    if (!String(template.useWhen || "").trim()) throw new Error(`missing Page template useWhen: ${id}`);
    ids.add(id);
  }
  return parsed;
}

export function listPageTemplates({ registry = readPageTemplateRegistry() } = {}) {
  return registry.templates.map((template) => ({
    id: template.id,
    name: template.name,
    category: template.category,
    skill: template.skill,
    status: template.status,
    summary: template.summary,
    useWhen: template.useWhen,
    matchTerms: [...template.matchTerms],
    desktop: Boolean(template.desktop),
    mobileLandscape: Boolean(template.mobileLandscape),
  }));
}

export function inspectPageTemplate(id, { registry = readPageTemplateRegistry() } = {}) {
  const normalizedId = String(id || "").trim();
  return registry.templates.find((template) => template.id === normalizedId) || null;
}
