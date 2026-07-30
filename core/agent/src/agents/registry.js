import fs from "node:fs";
import path from "node:path";

const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readAgentRegistry(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const registryPath = path.join(root, "registry", "agents.json");
  if (!fs.existsSync(registryPath)) return { schemaVersion: 1, agents: [] };
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.agents)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent 注册表格式无效");
  }
  const ids = new Set();
  const agents = registry.agents.map((entry) => normalizeAgentEntry(root, entry, ids));
  return { schemaVersion: 1, agents };
}

export function listAgentProfiles(workspaceRoot) {
  return readAgentRegistry(workspaceRoot).agents;
}

export function serializeAgentProfile(agent) {
  const styleContract = agent.styleContract;
  return {
    id: agent.id,
    version: agent.version,
    displayName: agent.displayName,
    description: agent.description,
    publicProfile: structuredClone(agent.publicProfile),
    skills: [...agent.skills],
    routing: [...agent.routing],
    styleCatalogVersion: styleContract?.catalogVersion || null,
    defaultStyleId: styleContract?.defaultStyleId || null,
    styles: styleContract ? summarizeStyles(styleContract.styles) : [],
    example: agent.example ? structuredClone(agent.example) : null,
  };
}

export function resolveAgentProfile(workspaceRoot, agentId) {
  const id = normalizeAgentId(agentId);
  if (!id) return null;
  const profile = listAgentProfiles(workspaceRoot).find((entry) => entry.id === id);
  if (!profile) {
    throw agentRegistryError("AGENT_PROFILE_NOT_FOUND", `未知的专业子 Agent：${id}`, 400);
  }
  return profile;
}

export function buildAgentCatalogInstructions(workspaceRoot) {
  const profiles = listAgentProfiles(workspaceRoot);
  if (!profiles.length) return "";
  const catalog = profiles.map((profile) => ({
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    skills: profile.skills,
    routing: profile.routing,
    ...(profile.styleContract ? {
      defaultStyleId: profile.styleContract.defaultStyleId,
      styles: summarizeStyles(profile.styleContract.styles, true),
    } : {}),
  }));
  return [
    "当前安装已注册以下专业子 Agent。只有当一个专业领域明确拥有本次实质工作的主体时才选择；否则继续使用通用任务。",
    JSON.stringify(catalog),
    "启动新专业项目时使用 pa-cli session start --agent <agent-id> --project-key <稳定项目键>，并继续传入 --parent、标题、描述和完整任务。",
    "继续同一专业项目时，先用 pa-cli session list --parent <主会话> --agent <agent-id> --project-key <项目键> --all --json 查找唯一会话，再 resume；不得仅凭相似关键词续接。",
  ].join("\n");
}

export function buildSpecialistAgentInstructions(workspaceRoot, metadata = {}) {
  const profile = resolveAgentProfile(workspaceRoot, metadata.agentId);
  if (!profile) return "";
  const instructionsPath = safeAgentPath(workspaceRoot, profile.directory, profile.instructions);
  const instructions = fs.readFileSync(instructionsPath, "utf8").trim();
  const styleInstructions = profile.styleContract
    ? [
      `默认创作风格：${profile.styleContract.defaultStyleId}；风格目录版本：${profile.styleContract.catalogVersion}`,
      `可选创作风格：${JSON.stringify(summarizeStyles(profile.styleContract.styles))}`,
      `完整风格参数：${profile.directory}/${profile.styleCatalog}。开工前必须读取所选风格的完整条目，并把选型记录写入 BRIEF.md。`,
      fs.readFileSync(safeAgentPath(workspaceRoot, profile.directory, profile.styleGuide), "utf8").trim(),
    ]
    : [];
  return [
    `专业子 Agent：${profile.displayName}（${profile.id}@${profile.version}）`,
    `项目身份：${String(metadata.projectKey || "").trim()}`,
    `推荐优先 Skill：${profile.skills.join("、")}`,
    ...styleInstructions,
    instructions,
  ].join("\n\n");
}

function normalizeAgentEntry(root, entry, ids) {
  const id = normalizeAgentId(entry?.id);
  if (!id || ids.has(id)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent ID 无效或重复：${entry?.id || ""}`);
  }
  ids.add(id);
  const directory = String(entry.directory || "");
  if (directory !== `agents/${id}`) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 目录无效：${directory}`);
  }
  const instructions = String(entry.instructions || "");
  if (instructions !== "AGENT.md") {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 说明文件无效：${instructions}`);
  }
  const instructionsPath = safeAgentPath(root, directory, instructions);
  if (!fs.statSync(instructionsPath, { throwIfNoEntry: false })?.isFile()) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 说明不存在：${directory}/${instructions}`);
  }
  const hasStyleContract = Boolean(entry.styleGuide || entry.styleCatalog);
  const styleGuide = hasStyleContract ? String(entry.styleGuide || "") : null;
  const styleCatalog = hasStyleContract ? String(entry.styleCatalog || "") : null;
  let styleContract = null;
  if (hasStyleContract) {
    if (styleGuide !== "STYLE-GUIDE.md" || styleCatalog !== "styles.json") {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 风格合同无效：${id}`);
    }
    const styleGuidePath = safeAgentPath(root, directory, styleGuide);
    if (!fs.statSync(styleGuidePath, { throwIfNoEntry: false })?.isFile()) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 风格指南不存在：${directory}/${styleGuide}`);
    }
    styleContract = readStyleContract(root, directory, styleCatalog);
  }
  return {
    id,
    version: positiveInteger(entry.version, "version"),
    displayName: requiredText(entry.displayName, "displayName"),
    description: requiredText(entry.description, "description"),
    publicProfile: normalizePublicProfile(entry.publicProfile),
    directory,
    instructions,
    ...(hasStyleContract ? { styleGuide, styleCatalog, styleContract } : { styleContract: null }),
    skills: uniqueTextList(entry.skills, "skills"),
    routing: uniqueTextList(entry.routing, "routing"),
    ...(entry.example ? { example: normalizeAgentExample(root, entry.example) } : {}),
  };
}

function normalizeAgentExample(root, value) {
  const allowed = new Set(["id", "kind", "eyebrow", "title", "description", "format", "src", "poster", "items", "devices", "meta"]);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent 代表产物格式无效");
  }
  const kind = String(value.kind || "");
  if (!["page", "gallery", "image", "video"].includes(kind)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent 代表产物类型无效");
  }
  const devices = uniqueTextList(value.devices, "example.devices");
  if (devices.length > 2 || devices.some((device) => !["web", "mobile"].includes(device))) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent example.devices 无效");
  }
  const example = {
    id: normalizeAgentId(value.id),
    kind,
    eyebrow: boundedText(value.eyebrow, "example.eyebrow", 80),
    title: boundedText(value.title, "example.title", 100),
    description: boundedText(value.description, "example.description", 300),
    format: boundedText(value.format, "example.format", 100),
    devices,
    meta: boundedTextList(value.meta, "example.meta"),
  };
  if (!example.id) throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent example.id 无效");
  if (["page", "image", "video"].includes(kind)) example.src = normalizeExampleAsset(root, value.src);
  if (kind === "video") example.poster = normalizeExampleAsset(root, value.poster);
  if (kind === "gallery") {
    if (!Array.isArray(value.items) || value.items.length < 2 || value.items.length > 12) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent example.items 无效");
    }
    example.items = value.items.map((item) => ({
      src: normalizeExampleAsset(root, item?.src),
      alt: boundedText(item?.alt, "example.items.alt", 160),
    }));
  }
  return example;
}

function normalizeExampleAsset(root, value) {
  const route = String(value || "").trim();
  if (!/^\/assets\/(?:agent-examples|templates)\/[A-Za-z0-9._/-]+$/.test(route)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 代表产物路径无效：${route}`);
  }
  const publicRoot = path.resolve(root, "core", "app", "public");
  const assetPath = path.resolve(publicRoot, route.slice(1));
  if (!assetPath.startsWith(`${publicRoot}${path.sep}`) || !fs.statSync(assetPath, { throwIfNoEntry: false })?.isFile()) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 代表产物不存在：${route}`);
  }
  return route;
}

function normalizePublicProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent 缺少 publicProfile");
  }
  const expected = ["role", "tagline", "capabilities", "inputs", "outputs", "boundaries"];
  if (Object.keys(value).some((key) => !expected.includes(key))) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent publicProfile 包含未知字段");
  }
  return {
    role: boundedText(value.role, "publicProfile.role", 80),
    tagline: boundedText(value.tagline, "publicProfile.tagline", 160),
    capabilities: boundedTextList(value.capabilities, "publicProfile.capabilities"),
    inputs: boundedTextList(value.inputs, "publicProfile.inputs"),
    outputs: boundedTextList(value.outputs, "publicProfile.outputs"),
    boundaries: boundedTextList(value.boundaries, "publicProfile.boundaries"),
  };
}

function readStyleContract(workspaceRoot, directory, file) {
  const stylePath = safeAgentPath(workspaceRoot, directory, file);
  if (!fs.statSync(stylePath, { throwIfNoEntry: false })?.isFile()) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 风格目录不存在：${directory}/${file}`);
  }
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(stylePath, "utf8"));
  } catch (error) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 风格目录 JSON 无效：${error.message}`);
  }
  if (catalog?.schemaVersion !== 1 || !/^20\d{2}\.\d{2}$/.test(String(catalog.catalogVersion || ""))) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "视频风格目录版本无效");
  }
  if (
    catalog.selectionPolicy?.primaryRequired !== true
    || catalog.selectionPolicy?.secondaryOptional !== true
    || !Number.isInteger(catalog.selectionPolicy?.maxSecondarySharePercent)
    || catalog.selectionPolicy.maxSecondarySharePercent < 0
    || catalog.selectionPolicy.maxSecondarySharePercent > 30
    || !validTextList(catalog.selectionPolicy?.decisionRecordFields, 6)
  ) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "视频风格选型策略无效");
  }
  const sources = Array.isArray(catalog.researchSources) ? catalog.researchSources : [];
  const sourceIds = new Set(sources.map((source) => normalizeAgentId(source?.id)));
  if (
    sourceIds.size !== sources.length
    || sourceIds.has("")
    || sources.length < 5
    || !sources.every((source) => (
      String(source.title || "").trim()
      && String(source.publisher || "").trim()
      && /^(https:\/\/|local:)/.test(String(source.url || ""))
      && validTextList(source.appliedPrinciples)
    ))
  ) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "视频风格研究来源无效");
  }
  const styles = Array.isArray(catalog.styles) ? catalog.styles : [];
  const styleIds = new Set();
  for (const style of styles) {
    const styleId = normalizeAgentId(style?.id);
    if (
      !styleId
      || styleIds.has(styleId)
      || !Number.isInteger(style.version)
      || style.version < 1
      || !String(style.displayName || "").trim()
      || !String(style.summary || "").trim()
      || !["product", "travel", "hybrid"].includes(style.category)
    ) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `视频风格条目无效：${style?.id || ""}`);
    }
    if (!validTextList(style.useWhen) || !validTextList(style.avoidWhen)) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `视频风格缺少选型边界：${styleId}`);
    }
    if (!Array.isArray(style.referenceBasis) || !style.referenceBasis.length || !style.referenceBasis.every((id) => sourceIds.has(id))) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `视频风格研究依据无效：${styleId}`);
    }
    for (const section of ["narrative", "visual", "motion", "audio", "format"]) {
      if (!style[section] || typeof style[section] !== "object") {
        throw agentRegistryError("AGENT_REGISTRY_INVALID", `视频风格缺少 ${section}：${styleId}`);
      }
    }
    if (
      !validTextList(style.narrative.arc)
      || !String(style.narrative.proofRule || "").trim()
      || !validTextList(style.visual.palette)
      || !String(style.visual.tone || "").trim()
      || !String(style.visual.typography || "").trim()
      || !String(style.visual.composition || "").trim()
      || !validNumberRange(style.motion.shotDurationSeconds)
      || !validNumberRange(style.motion.transitionDurationSeconds)
      || !validNumberRange(style.audio.bpm)
      || !validNumberRange(style.format.durationSeconds)
      || !["16:9", "9:16", "1:1"].includes(style.format.primaryAspect)
      || !validTextList(style.format.variants)
      || !String(style.format.captionRule || "").trim()
      || !validTextList(style.acceptance, 3)
    ) {
      throw agentRegistryError("AGENT_REGISTRY_INVALID", `视频风格缺少验收标准：${styleId}`);
    }
    styleIds.add(styleId);
  }
  if (styles.length < 3 || !styleIds.has(String(catalog.defaultStyleId || ""))) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "视频风格目录缺少有效默认风格");
  }
  return structuredClone(catalog);
}

function validTextList(value, minimum = 1) {
  return Array.isArray(value)
    && value.length >= minimum
    && value.every((item) => typeof item === "string" && item.trim())
    && new Set(value).size === value.length;
}

function validNumberRange(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => Number.isFinite(item) && item >= 0)
    && value[1] > value[0];
}

function summarizeStyles(styles, compact = false) {
  return styles.map((style) => ({
    id: style.id,
    version: style.version,
    displayName: style.displayName,
    category: style.category,
    summary: style.summary,
    ...(compact ? {} : {
      useWhen: style.useWhen,
      avoidWhen: style.avoidWhen,
      primaryAspect: style.format.primaryAspect,
      durationSeconds: style.format.durationSeconds,
    }),
  }));
}

function safeAgentPath(workspaceRoot, directory, file = "") {
  const root = path.resolve(workspaceRoot, "agents");
  const target = path.resolve(workspaceRoot, directory, file);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", "专业子 Agent 路径越出 agents 目录");
  }
  return target;
}

function normalizeAgentId(value) {
  const id = String(value || "").trim();
  return AGENT_ID_PATTERN.test(id) && id.length <= 64 ? id : "";
}

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 缺少 ${field}`);
  return text;
}

function boundedText(value, field, maximum) {
  const text = requiredText(value, field);
  if (text.length > maximum) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent ${field} 过长`);
  }
  return text;
}

function boundedTextList(value, field) {
  const items = uniqueTextList(value, field);
  if (items.length > 8 || items.some((item) => item.length > 160)) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent ${field} 无效`);
  }
  return items;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent ${field} 无效`);
  }
  return number;
}

function uniqueTextList(value, field) {
  if (!Array.isArray(value) || !value.length) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent 缺少 ${field}`);
  }
  const items = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (items.length !== value.length || new Set(items).size !== items.length) {
    throw agentRegistryError("AGENT_REGISTRY_INVALID", `专业子 Agent ${field} 无效`);
  }
  return items;
}

function agentRegistryError(code, message, statusCode = 500) {
  return Object.assign(new Error(message), { code, statusCode });
}
