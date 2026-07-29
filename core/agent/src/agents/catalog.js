import fs from "node:fs";
import path from "node:path";

const AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROJECT_KEY_PATTERN = /^project_[a-z0-9][a-z0-9_-]{5,95}$/;
const PUBLIC_AGENT_STATUSES = new Set(["available", "updating", "unavailable"]);

export class AgentCatalog {
  constructor({ workspaceRoot, releaseRoot = workspaceRoot } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.releaseRoot = path.resolve(releaseRoot || this.workspaceRoot);
  }

  listPublic() {
    return this.loadRecords().map((record) => publicAgent(record));
  }

  inspectPublic(agentId) {
    const id = normalizeAgentId(agentId);
    const record = this.loadRecords().find((candidate) => candidate.id === id);
    if (!record) throw agentError("AGENT_NOT_FOUND", `Unknown Agent: ${id}`, 404);
    return publicAgent(record);
  }

  inspectInternal(agentId, { profileVersion } = {}) {
    const id = normalizeAgentId(agentId);
    const record = this.loadRecords().find((candidate) => candidate.id === id);
    if (!record) throw agentError("AGENT_NOT_FOUND", `Unknown Agent: ${id}`, 400);
    if (record.status !== "available" || !record.internal) {
      throw agentError("AGENT_UNAVAILABLE", `Agent is unavailable: ${id}`, 503);
    }
    if (profileVersion !== undefined && Number(profileVersion) !== record.internal.version) {
      throw agentError(
        "AGENT_PROFILE_VERSION_MISMATCH",
        `Agent profile version is not available: ${id}@${profileVersion}`,
        409,
      );
    }
    return record.internal;
  }

  compactRoutingGuide() {
    const entries = this.loadRecords().map((record) => {
      const summary = String(record.routingSummary || record.description || "").trim();
      return `- ${record.id}: ${record.displayName}；${summary}；状态=${record.status}`;
    });
    return entries.length
      ? ["可用的专业子 Agent 精简目录：", ...entries].join("\n")
      : "当前没有注册的专业子 Agent；没有明确匹配时继续使用通用 Worker。";
  }

  loadRecords() {
    const source = resolveCatalogSource(this.workspaceRoot, this.releaseRoot);
    if (!source) return [];
    const registry = readJson(source.registryPath);
    if (!registry || !Array.isArray(registry.agents)) {
      throw agentError("AGENT_REGISTRY_INVALID", "Agent registry is invalid", 500);
    }
    const ids = new Set();
    return registry.agents.map((entry) => {
      const id = normalizeAgentId(entry?.id);
      if (ids.has(id)) throw agentError("AGENT_REGISTRY_INVALID", `Duplicate Agent id: ${id}`, 500);
      ids.add(id);
      return loadAgentRecord(source.root, entry, id);
    });
  }
}

export function createAgentCatalog(options = {}) {
  return new AgentCatalog(options);
}

export function normalizeAgentId(value, { optional = false } = {}) {
  const id = String(value || "").trim();
  if (!id && optional) return "";
  if (!AGENT_ID_PATTERN.test(id) || id.length > 64) {
    throw agentError("AGENT_ID_INVALID", "agentId must be a lowercase kebab-case identifier", 400);
  }
  return id;
}

export function normalizeProjectKey(value, { optional = false } = {}) {
  const key = String(value || "").trim();
  if (!key && optional) return "";
  if (!PROJECT_KEY_PATTERN.test(key)) {
    throw agentError("PROJECT_KEY_INVALID", "projectKey must use the project_<stable-id> format", 400);
  }
  return key;
}

function resolveCatalogSource(workspaceRoot, releaseRoot) {
  for (const root of [...new Set([workspaceRoot, releaseRoot].map((entry) => path.resolve(entry)))]) {
    const registryPath = path.join(root, "registry", "agents.json");
    const agentsRoot = path.join(root, "agents");
    if (fs.existsSync(registryPath) && fs.existsSync(agentsRoot)) return { root, registryPath, agentsRoot };
  }
  return null;
}

function loadAgentRecord(root, entry, id) {
  const relativeDirectory = String(entry?.directory || entry?.path || `agents/${id}`).replaceAll("\\", "/");
  const agentsRoot = path.join(root, "agents");
  const directory = path.resolve(root, ...relativeDirectory.split("/"));
  const fallback = {
    id,
    displayName: String(entry?.displayName || id),
    description: String(entry?.description || ""),
    routingSummary: String(entry?.routing?.summary || entry?.routingSummary || ""),
    profile: {},
    status: "unavailable",
    internal: null,
  };
  if (!isInside(agentsRoot, directory)) return fallback;
  try {
    const agentPath = path.join(directory, "agent.yaml");
    const profilePath = path.join(directory, "profile.yaml");
    const instructionsPath = path.join(directory, "AGENT.md");
    for (const filePath of [agentPath, profilePath, instructionsPath]) {
      if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`missing ${path.basename(filePath)}`);
      }
    }
    const agent = parseYaml(fs.readFileSync(agentPath, "utf8"));
    const profile = parseYaml(fs.readFileSync(profilePath, "utf8"));
    const instructions = fs.readFileSync(instructionsPath, "utf8").trim();
    if (normalizeAgentId(agent.id) !== id) throw new Error("agent.yaml id mismatch");
    const version = Number(agent.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("invalid Agent version");
    if (Number(agent.schemaVersion) !== 1 || Number(profile.schemaVersion) !== 1) {
      throw new Error("unsupported Agent schema version");
    }
    if (!instructions) throw new Error("empty Agent instructions");
    const skills = Array.isArray(agent.skills) ? agent.skills.map((skill) => String(skill).trim()).filter(Boolean) : [];
    if (!skills.length || skills.some((skill) => !hasSkill(root, skill))) throw new Error("unknown Agent Skill");
    const configuredStatus = String(entry?.status || agent.status || "available");
    const status = PUBLIC_AGENT_STATUSES.has(configuredStatus) ? configuredStatus : "unavailable";
    const displayName = String(agent.displayName || entry?.displayName || id).trim();
    const description = String(agent.description || entry?.description || "").trim();
    const routingSummary = String(agent.routing?.summary || entry?.routing?.summary || entry?.routingSummary || "").trim();
    if (!displayName || !description || !routingSummary) throw new Error("missing public Agent summary");
    assertPublicValue(profile);
    return {
      id,
      displayName,
      description,
      routingSummary,
      profile: clone(profile),
      status,
      internal: status === "available" ? {
        id,
        version,
        displayName,
        description,
        routingSummary,
        skills,
        instructions,
        profile: clone(profile),
      } : null,
    };
  } catch {
    return fallback;
  }
}

function publicAgent(record) {
  return {
    id: record.id,
    displayName: record.displayName,
    description: record.description,
    profile: clone(record.profile),
    status: PUBLIC_AGENT_STATUSES.has(record.status) ? record.status : "unavailable",
  };
}

function hasSkill(root, skill) {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(skill)
    && fs.statSync(path.join(root, "skills", skill, "SKILL.md"), { throwIfNoEntry: false })?.isFile();
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertPublicValue(value) {
  const text = JSON.stringify(value);
  if (/<script\b|file:\/\/|https?:\/\/(?:127\.0\.0\.1|localhost)|(?:[A-Za-z]:\\|\/(?:Users|home|root)\/)|\bsecret\b/i.test(text)) {
    throw new Error("unsafe public Agent profile");
  }
}

function parseYaml(source) {
  const text = String(source || "").replace(/^\uFEFF/, "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {}
  const lines = text.split(/\r?\n/)
    .map((raw, index) => ({ raw, index, indent: raw.match(/^\s*/)?.[0].length || 0, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith("#") && line.text !== "---" && line.text !== "...");
  if (!lines.length) return {};
  const [value, next] = parseYamlBlock(lines, 0, lines[0].indent);
  if (next !== lines.length) throw new Error(`invalid YAML near line ${lines[next].index + 1}`);
  return value;
}

function parseYamlBlock(lines, start, indent) {
  const array = lines[start]?.indent === indent && lines[start].text.startsWith("-");
  const result = array ? [] : {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent) throw new Error(`invalid YAML indentation near line ${line.index + 1}`);
    if (array) {
      if (!line.text.startsWith("-")) break;
      const rest = line.text.slice(1).trim();
      if (!rest) {
        const child = lines[index + 1];
        if (!child || child.indent <= indent) result.push(null);
        else {
          const parsed = parseYamlBlock(lines, index + 1, child.indent);
          result.push(parsed[0]);
          index = parsed[1] - 1;
        }
      } else if (looksLikeMapping(rest)) {
        const item = {};
        const [key, rawValue] = splitMapping(rest);
        if (rawValue) item[key] = parseYamlScalar(rawValue);
        else if (lines[index + 1]?.indent > indent) {
          const parsed = parseYamlBlock(lines, index + 1, lines[index + 1].indent);
          item[key] = parsed[0];
          index = parsed[1] - 1;
        } else item[key] = {};
        const next = lines[index + 1];
        if (next?.indent > indent && !next.text.startsWith("-")) {
          const parsed = parseYamlBlock(lines, index + 1, next.indent);
          Object.assign(item, parsed[0]);
          index = parsed[1] - 1;
        }
        result.push(item);
      } else result.push(parseYamlScalar(rest));
    } else {
      if (line.text.startsWith("-")) break;
      const [key, rawValue] = splitMapping(line.text);
      if (!key) throw new Error(`invalid YAML mapping near line ${line.index + 1}`);
      if (rawValue === "|" || rawValue === ">") {
        const fragments = [];
        index += 1;
        while (index < lines.length && lines[index].indent > indent) {
          fragments.push(lines[index].raw.slice(Math.min(lines[index].raw.length, indent + 2)));
          index += 1;
        }
        result[key] = rawValue === ">" ? fragments.join(" ").replace(/\s+/g, " ").trim() : fragments.join("\n");
        index -= 1;
      } else if (rawValue) result[key] = parseYamlScalar(rawValue);
      else {
        const child = lines[index + 1];
        if (!child || child.indent <= indent) result[key] = {};
        else {
          const parsed = parseYamlBlock(lines, index + 1, child.indent);
          result[key] = parsed[0];
          index = parsed[1] - 1;
        }
      }
    }
    index += 1;
  }
  return [result, index];
}

function looksLikeMapping(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(value);
}

function splitMapping(value) {
  const match = /^([^:]+):(?:\s*(.*))?$/.exec(value);
  if (!match) throw new Error("invalid YAML mapping");
  return [match[1].trim(), String(match[2] || "").trim()];
}

function parseYamlScalar(value) {
  const text = String(value).trim();
  if (!text) return "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try { return JSON.parse(text); } catch {}
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text === "true" || text === "false") return text === "true";
  if (text === "null" || text === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  return text.replace(/\s+#.*$/, "").trim();
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function agentError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}
