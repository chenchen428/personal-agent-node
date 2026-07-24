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
  "personal-pages",
  "personal-product-development",
  "personal-runtime",
  "personal-schedules",
  "personal-tasks",
  "personal-updates",
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
  for (const directory of ["skills", "workflows", "registry"]) {
    const source = fs.existsSync(path.join(seedRoot, directory))
      ? path.join(seedRoot, directory)
      : path.join(releaseRoot, directory);
    copied += copyMissingTree(source, path.join(config.agentWorkspaceRoot, directory));
  }
  for (const script of ["skill-tree.mjs", "skill-guard.mjs"]) {
    const source = fs.existsSync(path.join(seedRoot, "scripts", script))
      ? path.join(seedRoot, "scripts", script)
      : path.join(releaseRoot, "scripts", script);
    copied += copyMissingTree(source, path.join(config.agentWorkspaceRoot, "scripts", script));
  }
  const retiredSkills = retireSplitPersonalAgentSkill(config, seedRoot, now);
  createDirectoryPointer(
    path.join(config.agentWorkspaceRoot, "skills"),
    path.join(config.agentWorkspaceRoot, ".codex", "skills"),
  );
  return { copied, retiredSkills };
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
  const timestamp = now().toISOString().replace(/\D/g, "").slice(0, 14);
  const archive = uniquePath(path.join(archiveRoot, `personal-agent-${timestamp}`));
  moveDirectory(legacySkill, archive);
  return [path.relative(config.dataRoot, archive).split(path.sep).join("/")];
}

function moveDirectory(source: string, target: string) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
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
