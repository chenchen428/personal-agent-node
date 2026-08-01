import fs from "node:fs";
import path from "node:path";

export const PERSONAL_AGENT_SPLIT_SKILLS = [
  "personal-acceptance",
  "personal-activity",
  "personal-bug-report",
  "personal-connections",
  "personal-connectivity",
  "personal-data",
  "personal-files",
  "personal-memory",
  "personal-product-development",
  "personal-runtime",
  "personal-schedules",
  "personal-tasks",
  "personal-updates",
] as const;

const PRODUCT_MANAGED_INTERIOR_DELIVERY_CAPABILITIES = [
  "skills/interior-design",
  "registry/interior-design.json",
  "registry/skills.json",
] as const;

const PRODUCT_MANAGED_AGENT_CAPABILITIES = [
  "agents/interior-designer",
  "agents/poster-designer",
  "agents/video-creator",
  "agents/travel-planner",
  "agents/finance-analyst",
  "registry/agents.json",
  "schemas/personal-agent/agents.schema.json",
  "schemas/personal-agent/agent-profile.schema.json",
  "schemas/personal-agent/agent-workflow.schema.json",
  "core/agent/src/agents/workflow.js",
  "scripts/agent-guard.mjs",
] as const;

export function seedAgentWorkspace(config: {
  agentWorkspaceRoot: string;
  dataRoot: string;
}, {
  releaseRoot,
  now = () => new Date(),
}: {
  releaseRoot: string;
  now?: () => Date;
}) {
  const seedRoot = path.join(releaseRoot, "workspace");
  const nodeGuide = fs.existsSync(path.join(seedRoot, "AGENTS.md"))
    ? path.join(seedRoot, "AGENTS.md")
    : path.join(releaseRoot, "AGENTS.md");
  let copied = copyMissingTree(nodeGuide, path.join(config.agentWorkspaceRoot, "AGENTS.md"));
  for (const directory of ["agents", "skills", "workflows", "registry", "schemas"]) {
    const source = fs.existsSync(path.join(seedRoot, directory))
      ? path.join(seedRoot, directory)
      : path.join(releaseRoot, directory);
    copied += copyMissingTree(source, path.join(config.agentWorkspaceRoot, directory));
  }
  for (const script of ["agent-guard.mjs", "skill-tree.mjs", "skill-guard.mjs"]) {
    const source = fs.existsSync(path.join(seedRoot, "scripts", script))
      ? path.join(seedRoot, "scripts", script)
      : path.join(releaseRoot, "scripts", script);
    copied += copyMissingTree(source, path.join(config.agentWorkspaceRoot, "scripts", script));
  }
  const refreshedPaths = [
    ...refreshProductManagedInteriorDeliveryCapabilities(seedRoot, config.agentWorkspaceRoot),
    ...refreshProductManagedAgentCapabilities(seedRoot, config.agentWorkspaceRoot),
  ];
  const retiredSkills = [
    ...retireSplitPersonalAgentSkill(config, seedRoot, now),
    ...retireRemovedProductSkill(config, seedRoot, "personal-pages", now),
  ];
  const retiredRegistries = retireRemovedProductRegistry(config, seedRoot, "page-templates.json", now);
  createDirectoryPointer(
    path.join(config.agentWorkspaceRoot, "skills"),
    path.join(config.agentWorkspaceRoot, ".codex", "skills"),
  );
  return { copied, refreshed: refreshedPaths.length, refreshedPaths, retiredSkills, retiredRegistries };
}

export function copyMissingTree(source: string, target: string): number {
  const sourceStat = fs.statSync(source, { throwIfNoEntry: false });
  if (!sourceStat) return 0;
  const targetStat = fs.statSync(target, { throwIfNoEntry: false });
  if (!targetStat) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
    return 1;
  }
  if (!sourceStat.isDirectory() || !targetStat.isDirectory()) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(source)) {
    copied += copyMissingTree(path.join(source, entry), path.join(target, entry));
  }
  return copied;
}

function refreshProductManagedInteriorDeliveryCapabilities(seedRoot: string, agentWorkspaceRoot: string) {
  const refreshed: string[] = [];
  for (const relative of PRODUCT_MANAGED_INTERIOR_DELIVERY_CAPABILITIES) {
    const source = path.join(seedRoot, ...relative.split("/"));
    const target = path.join(agentWorkspaceRoot, ...relative.split("/"));
    if (replaceManagedPath(source, target)) refreshed.push(relative);
  }
  return refreshed;
}

function retireRemovedProductSkill(config: {
  agentWorkspaceRoot: string;
  dataRoot: string;
}, seedRoot: string, name: string, now: () => Date) {
  const releaseSkill = path.join(seedRoot, "skills", name);
  const activeSkill = path.join(config.agentWorkspaceRoot, "skills", name);
  if (fs.existsSync(releaseSkill) || !fs.existsSync(activeSkill)) return [];
  const archiveRoot = path.join(config.dataRoot, "runtime", "harness-migrations", "retired-skills");
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const archive = uniquePath(path.join(archiveRoot, `${name}-${migrationTimestamp(now)}`));
  movePath(activeSkill, archive);
  return [path.relative(config.dataRoot, archive).split(path.sep).join("/")];
}

function retireRemovedProductRegistry(config: {
  agentWorkspaceRoot: string;
  dataRoot: string;
}, seedRoot: string, name: string, now: () => Date) {
  const releaseRegistry = path.join(seedRoot, "registry", name);
  const activeRegistry = path.join(config.agentWorkspaceRoot, "registry", name);
  if (fs.existsSync(releaseRegistry) || !fs.existsSync(activeRegistry)) return [];
  const archiveRoot = path.join(config.dataRoot, "runtime", "harness-migrations", "retired-registries");
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const archive = uniquePath(path.join(archiveRoot, `${path.basename(name, path.extname(name))}-${migrationTimestamp(now)}${path.extname(name)}`));
  movePath(activeRegistry, archive);
  return [path.relative(config.dataRoot, archive).split(path.sep).join("/")];
}

function refreshProductManagedAgentCapabilities(seedRoot: string, agentWorkspaceRoot: string) {
  const refreshed: string[] = [];
  for (const relative of PRODUCT_MANAGED_AGENT_CAPABILITIES) {
    const source = path.join(seedRoot, ...relative.split("/"));
    const target = path.join(agentWorkspaceRoot, ...relative.split("/"));
    if (replaceManagedPath(source, target)) refreshed.push(relative);
  }
  return refreshed;
}

function replaceManagedPath(source: string, target: string) {
  const sourceStat = fs.statSync(source, { throwIfNoEntry: false });
  if (!sourceStat || pathsEqual(source, target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.product-seed-${process.pid}`;
  const previous = `${target}.product-previous-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });
  fs.cpSync(source, temporary, {
    recursive: sourceStat.isDirectory(),
    preserveTimestamps: true,
  });
  const targetStat = fs.statSync(target, { throwIfNoEntry: false });
  if (targetStat) fs.renameSync(target, previous);
  try {
    fs.renameSync(temporary, target);
    fs.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    if (targetStat && !fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
    throw error;
  }
  return true;
}

function pathsEqual(left: string, right: string): boolean {
  const leftStat = fs.statSync(left, { throwIfNoEntry: false });
  const rightStat = fs.statSync(right, { throwIfNoEntry: false });
  if (!leftStat || !rightStat || leftStat.isDirectory() !== rightStat.isDirectory()) return false;
  if (leftStat.isFile()) {
    return leftStat.size === rightStat.size && fs.readFileSync(left).equals(fs.readFileSync(right));
  }
  const leftEntries = fs.readdirSync(left).sort();
  const rightEntries = fs.readdirSync(right).sort();
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every((entry, index) => (
    entry === rightEntries[index] && pathsEqual(path.join(left, entry), path.join(right, entry))
  ));
}

function retireSplitPersonalAgentSkill(config: {
  agentWorkspaceRoot: string;
  dataRoot: string;
}, seedRoot: string, now: () => Date) {
  const sourceSkills = path.join(seedRoot, "skills");
  const activeSkills = path.join(config.agentWorkspaceRoot, "skills");
  const legacySkill = path.join(activeSkills, "personal-agent");
  if (fs.existsSync(path.join(sourceSkills, "personal-agent")) || !fs.existsSync(legacySkill)) return [];
  const splitIsComplete = PERSONAL_AGENT_SPLIT_SKILLS.every((name) => (
    fs.existsSync(path.join(sourceSkills, name, "SKILL.md"))
    && fs.existsSync(path.join(activeSkills, name, "SKILL.md"))
  ));
  if (!splitIsComplete) return [];
  const archiveRoot = path.join(config.dataRoot, "runtime", "harness-migrations", "retired-skills");
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const archive = uniquePath(path.join(archiveRoot, `personal-agent-${migrationTimestamp(now)}`));
  movePath(legacySkill, archive);
  return [path.relative(config.dataRoot, archive).split(path.sep).join("/")];
}

function movePath(source: string, target: string) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const sourceStat = fs.statSync(source);
    fs.cpSync(source, target, { recursive: sourceStat.isDirectory(), errorOnExist: true, force: false, preserveTimestamps: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function migrationTimestamp(now: () => Date) {
  return now().toISOString().replace(/\D/g, "").slice(0, 14);
}

function uniquePath(candidate: string) {
  if (!fs.existsSync(candidate)) return candidate;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const next = `${candidate}-${suffix}`;
    if (!fs.existsSync(next)) return next;
  }
  throw new Error(`Unable to allocate retired Skill archive below ${path.dirname(candidate)}`);
}

function createDirectoryPointer(target: string, linkPath: string) {
  if (fs.existsSync(linkPath)) return;
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(
    process.platform === "win32" ? target : path.relative(path.dirname(linkPath), target),
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}
