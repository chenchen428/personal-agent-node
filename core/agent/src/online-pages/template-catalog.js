import crypto from "node:crypto";
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
  if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.templates)) {
    throw new Error("unsupported Page template registry");
  }
  const ids = new Set();
  for (const template of parsed.templates) {
    const id = String(template?.id || "");
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error("invalid or duplicate Page template id");
    if (!template.name || !template.category || !template.skill || !template.summary || template.status !== "built-in") {
      throw new Error(`incomplete Page template contract: ${id}`);
    }
    if (!Number.isInteger(template.implementation?.version)
      || template.implementation.version < 1
      || !String(template.implementation?.generator || "").trim()
      || !String(template.implementation?.artifactMarker || "").trim()) {
      throw new Error(`invalid Page template implementation: ${id}`);
    }
    if (template.acceptance?.visualOwner !== "user" || template.acceptance?.agentBrowserReview !== false) {
      throw new Error(`invalid Page template acceptance owner: ${id}`);
    }
    if (template.publicationContract?.verifyArtifactBeforePublish !== true
      || template.publicationContract?.persistProvenance !== true) {
      throw new Error(`invalid Page template publication contract: ${id}`);
    }
    if (!/^[a-z][a-z0-9-]{2,80}$/.test(String(template.exampleArtifact?.source || ""))
      || !["pagePath", "manifestPath", "coverPath"].every((field) => String(template.exampleArtifact?.[field] || "").startsWith("/assets/templates/"))) {
      throw new Error(`invalid Page template example artifact: ${id}`);
    }
    for (const field of ["matchTerms", "fixedFramework", "agentFreedom", "agentInstructions"]) {
      if (!Array.isArray(template[field]) || template[field].length === 0 || template[field].some((item) => !String(item || "").trim())) {
        throw new Error(`invalid Page template ${field}: ${id}`);
      }
    }
    if (!String(template.useWhen || "").trim()) throw new Error(`missing Page template useWhen: ${id}`);
    if (template.presentation !== undefined) {
      const presentationFields = [
        "coverAlt", "coverBadge", "coverFooter", "detailHeading", "detailDescription",
        "principleTitle", "principleDescription", "webEyebrow", "webLabel", "mobileEyebrow",
        "mobileLabel", "previewTitle",
      ];
      if (!template.presentation || typeof template.presentation !== "object"
        || presentationFields.some((field) => !String(template.presentation[field] || "").trim())) {
        throw new Error(`invalid Page template presentation: ${id}`);
      }
    }
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
    implementation: { ...template.implementation },
    exampleArtifact: { ...template.exampleArtifact },
    acceptance: { ...template.acceptance },
    publicationContract: { ...template.publicationContract },
    contractDigest: pageTemplateContractDigest(template),
  }));
}

export function inspectPageTemplate(id, { registry = readPageTemplateRegistry() } = {}) {
  const normalizedId = String(id || "").trim();
  const template = registry.templates.find((candidate) => candidate.id === normalizedId);
  return template ? { ...template, contractDigest: pageTemplateContractDigest(template) } : null;
}

export function pageTemplateContractDigest(template) {
  if (!template || typeof template !== "object") throw new Error("Page template contract is required");
  const { contractDigest: _ignored, ...contract } = template;
  return crypto.createHash("sha256").update(canonicalJson(contract)).digest("hex");
}

export function validatePageTemplateArtifact(templateId, content, { registry = readPageTemplateRegistry() } = {}) {
  const template = inspectPageTemplate(templateId, { registry });
  if (!template) throw new Error(`Unknown Page template: ${String(templateId || "").trim()}`);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "utf8");
  if (!bytes.length) throw new Error(`Page template artifact is empty: ${template.id}`);
  const html = bytes.toString("utf8");
  const expected = {
    marker: String(template.implementation.artifactMarker),
    id: template.id,
    version: String(template.implementation.version),
  };
  const actual = {
    marker: metaContent(html, "personal-agent-page-template"),
    id: metaContent(html, "personal-agent-page-template-id"),
    version: metaContent(html, "personal-agent-page-template-version"),
    bodyMarker: bodyAttribute(html, "data-template-marker"),
    bodyId: bodyAttribute(html, "data-template-id"),
    bodyVersion: bodyAttribute(html, "data-template-version"),
  };
  for (const [field, expectedValue] of Object.entries({
    marker: expected.marker,
    id: expected.id,
    version: expected.version,
    bodyMarker: expected.marker,
    bodyId: expected.id,
    bodyVersion: expected.version,
  })) {
    if (actual[field] !== expectedValue) {
      throw new Error(`Page template artifact ${field} mismatch for ${template.id}: expected ${expectedValue}, received ${actual[field] || "missing"}`);
    }
  }
  return {
    template,
    provenance: {
      id: template.id,
      version: template.implementation.version,
      contractDigest: template.contractDigest,
      artifactMarker: template.implementation.artifactMarker,
      artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

export function verifyPageTemplatePublication(input, content, options = {}) {
  const requested = input?.template;
  if (!requested) return null;
  const id = typeof requested === "string" ? requested : requested.id;
  if (!String(id || "").trim()) throw new Error("Page template publication requires template.id");
  const { provenance } = validatePageTemplateArtifact(id, content, options);
  if (requested && typeof requested === "object") {
    for (const field of ["version", "contractDigest", "artifactMarker", "artifactSha256"]) {
      if (requested[field] !== undefined && String(requested[field]) !== String(provenance[field])) {
        throw new Error(`Page template publication ${field} does not match the verified artifact`);
      }
    }
  }
  return provenance;
}

function metaContent(html, name) {
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    if (tagAttribute(match[0], "name") === name) return tagAttribute(match[0], "content");
  }
  return "";
}

function bodyAttribute(html, name) {
  const match = String(html).match(/<body\b[^>]*>/i);
  return match ? tagAttribute(match[0], name) : "";
}

function tagAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i"));
  return match ? String(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
