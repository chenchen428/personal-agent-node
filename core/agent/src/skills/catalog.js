import fs from "node:fs";
import path from "node:path";

export function readWorkspaceSkillCatalog(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const registryPath = path.join(root, "registry", "skills.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const categories = [...(registry.categories || [])]
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((category) => ({
      id: String(category.id || ""),
      label: String(category.label || category.id || "未分类"),
      description: String(category.description || ""),
    }));
  const registrySkills = Array.isArray(registry.skills) ? registry.skills : [];
  const registryByDirectory = new Map(registrySkills.map((entry) => [String(entry.directory || ""), entry]));
  const registryByName = new Map(registrySkills.map((entry) => [String(entry.name || ""), entry]));
  const skills = discoverSkillDirectories(root).map(({ directory, manifestPath }) => {
    const frontmatter = parseSkillFrontmatter(fs.readFileSync(manifestPath, "utf8"));
    const name = String(frontmatter.name || path.posix.basename(directory));
    const entry = registryByDirectory.get(directory) || registryByName.get(name) || {};
    return {
      name,
      description: String(frontmatter.description || "暂无描述。"),
      directory,
      category: String(entry.category || "uncategorized"),
      maturity: String(entry.maturity || ""),
      risks: Array.isArray(entry.risks) ? entry.risks.map(String) : [],
      security: entry.security && typeof entry.security === "object" ? { ...entry.security } : {},
      origin: entry.origin && typeof entry.origin === "object" ? { ...entry.origin } : {},
      cli: Array.isArray(entry.cli) ? entry.cli.map(String) : [],
      examples: Array.isArray(entry.examples) ? entry.examples.map(String) : [],
      caseRequired: entry.caseRequired === true,
      related: Array.isArray(entry.related) ? entry.related.map(String) : [],
    };
  });
  assertUniqueSkillNames(skills);
  if (skills.some((skill) => skill.category === "uncategorized")) {
    categories.push({
      id: "uncategorized",
      label: "未分类",
      description: "直接从当前 Workspace 的 skills 目录发现。",
    });
  }
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  skills.sort((left, right) => {
    const categoryDifference = (categoryOrder.get(left.category) ?? Number.MAX_SAFE_INTEGER)
      - (categoryOrder.get(right.category) ?? Number.MAX_SAFE_INTEGER);
    return categoryDifference || left.name.localeCompare(right.name);
  });
  return { categories, skills };
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

function discoverSkillDirectories(root) {
  const skillsRoot = path.join(root, "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      directory: path.posix.join("skills", entry.name),
      manifestPath: path.join(skillsRoot, entry.name, "SKILL.md"),
    }))
    .filter((entry) => fs.existsSync(entry.manifestPath) && fs.statSync(entry.manifestPath).isFile())
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function assertUniqueSkillNames(skills) {
  const names = new Set();
  for (const skill of skills) {
    if (names.has(skill.name)) throw new Error(`Duplicate skill name in skills directory: ${skill.name}`);
    names.add(skill.name);
  }
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
