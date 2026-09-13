import fs from "node:fs";
import path from "node:path";
import { matchesLegacySkill, readLegacyBaselines } from "./legacy.js";
import { userSkillManagement } from "./user-skill-tree.js";

/** Public projection: paths outside the Space never leave the local runtime. */
export function readWorkspaceSkillCatalog(workspaceRoot, options = {}) {
  const resolved = resolveWorkspaceSkills(workspaceRoot, options);
  return { ...resolved, skills: resolved.skills.map(({ skillPath, ...skill }) => ({ ...skill,
    ...(skill.source.kind === "user" ? { management: userSkillManagement(path.join(workspaceRoot, skill.directory), skill.directory) } : {}),
  })) };
}

/** Both UI and engine adapters consume this single source-aware catalog. */
export function resolveWorkspaceSkills(workspaceRoot, { releaseRoot, metadataRoots = [] } = {}) {
  const root = path.resolve(workspaceRoot);
  const release = releaseRoot ? path.resolve(releaseRoot) : metadataRoots.find((entry) => path.resolve(entry) !== root);
  const builtinRegistry = release ? readRegistry(release) : { skills: [], categories: [] };
  let userRegistry;
  try { userRegistry = readRegistry(root); } catch { userRegistry = { skills: [] }; }
  const baselines = readLegacyBaselines(release);
  const skills = [];
  let excludedLegacyCount = 0;
  for (const entry of builtinRegistry.skills || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || entry.directory !== 'skills/' + entry.name) throw new Error("Invalid builtin skill directory");
    const directory = path.join(release, "skills", entry.name);
    const record = readSkill(directory, entry.directory, "builtin", entry);
    if (!record) throw new Error("Builtin skill is missing: " + entry.name);
    skills.push(record);
  }
  if (!release || path.resolve(release) !== root) {
    const skillRoot = path.join(root, "skills");
    const rootStat = fs.lstatSync(skillRoot, { throwIfNoEntry: false });
    const entries = rootStat?.isDirectory() && !rootStat.isSymbolicLink() ? fs.readdirSync(skillRoot, { withFileTypes: true }) : [];
    if (rootStat?.isSymbolicLink()) skills.push(readSkill(skillRoot, "skills", "user", {}));
    for (const child of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.name.startsWith(".") || (!child.isDirectory() && !child.isSymbolicLink())) continue;
      const directory = "skills/" + child.name;
      const absolute = path.join(skillRoot, child.name);
      if (matchesLegacySkill(absolute, baselines.get(directory))) { excludedLegacyCount++; continue; }
      const metadata = (userRegistry.skills || []).find((entry) => entry.directory === directory) || {};
      const record = readSkill(absolute, directory, "user", metadata);
      if (record) skills.push(record);
    }
  }
  return { categories: [
    { id: "builtin", label: "内置技能", description: "随 Cove 提供的基础能力" },
    { id: "user", label: "我的技能", description: "你的总结、自定义和保留的技能" },
  ], skills, excludedLegacyCount };
}

function readRegistry(root) {
  const file = path.join(root, "registry", "skills.json");
  if (!fs.existsSync(file)) return { skills: [], categories: [] };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readSkill(absolute, directory, kind, metadata) {
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return null;
  const name = kind === "builtin" ? metadata.name : path.basename(directory);
  const common = { id: kind + ":" + directory, name, description: "", directory, category: kind,
    source: { kind }, maturity: String(metadata.maturity || ""), risks: [], security: {}, origin: {},
    cli: [], examples: [], caseRequired: false, related: [], status: "available" };
  if (stat.isSymbolicLink()) return { ...common, status: "unavailable", notice: "技能链接已保留，未自动加载。" };
  const skillPath = path.join(absolute, "SKILL.md");
  const skillStat = fs.lstatSync(skillPath, { throwIfNoEntry: false });
  if (!skillStat) return null;
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) return { ...common, status: "unavailable", notice: "技能入口已保留，未自动加载。" };
  const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8"));
  return { ...common, name: kind === "builtin" ? metadata.name : String(frontmatter.name || name),
    description: String(frontmatter.description || "暂无描述。"), skillPath,
    risks: Array.isArray(metadata.risks) ? metadata.risks.map(String) : [],
    security: metadata.security && typeof metadata.security === "object" ? { ...metadata.security } : {},
    origin: metadata.origin && typeof metadata.origin === "object" ? { ...metadata.origin } : {},
    cli: Array.isArray(metadata.cli) ? metadata.cli.map(String) : [],
    examples: Array.isArray(metadata.examples) ? metadata.examples.map(String) : [],
    caseRequired: metadata.caseRequired === true,
    related: Array.isArray(metadata.related) ? metadata.related.map(String) : [],
  };
}

export function parseSkillFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(source || ""));
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(lines[index]);
    if (!field) continue;
    const [, key, rawValue = ""] = field;
    if (/^[>|][+-]?$/.test(rawValue)) {
      const values = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        index += 1;
        values.push(lines[index].replace(/^\s+/, ""));
      }
      result[key] = rawValue.startsWith(">")
        ? values.join(" ").replace(/\s+/g, " ").trim()
        : values.join("\n").trim();
      continue;
    }
    result[key] = parseFrontmatterScalar(rawValue);
  }
  return result;
}


function parseFrontmatterScalar(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  return text;
}
