import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const COVE_BUILTIN_SKILLS = [
  "cove-acceptance", "cove-activity", "cove-bug-report", "cove-connections",
  "cove-connectivity", "cove-data", "cove-files", "cove-memory",
  "cove-product-development", "cove-runtime", "cove-schedules", "cove-tasks", "cove-updates",
] as const;

/** Product skills stay in the immutable release. Never migrate or rewrite user skill trees. */
export function seedAgentWorkspace(config: { agentWorkspaceRoot: string; dataRoot: string },
  { releaseRoot }: { releaseRoot: string; now?: () => Date }) {
  const seedRoot = path.join(releaseRoot, "workspace");
  const guide = fs.existsSync(path.join(seedRoot, "AGENTS.md")) ? path.join(seedRoot, "AGENTS.md") : path.join(releaseRoot, "AGENTS.md");
  let copied = copyMissingTree(guide, path.join(config.agentWorkspaceRoot, "AGENTS.md"));
  const refreshedPaths = refreshDefaultGuide(guide, path.join(config.agentWorkspaceRoot, "AGENTS.md"), releaseRoot) ? ["AGENTS.md"] : [];
  for (const directory of ["workflows", "registry", "schemas"]) {
    const source = fs.existsSync(path.join(seedRoot, directory)) ? path.join(seedRoot, directory) : path.join(releaseRoot, directory);
    copied += copyMissingTree(source, path.join(config.agentWorkspaceRoot, directory));
  }
  const skillRoot = path.join(config.agentWorkspaceRoot, "skills");
  if (!fs.lstatSync(skillRoot, { throwIfNoEntry: false })) fs.mkdirSync(skillRoot, { recursive: true, mode: 0o700 });
  // Existing .codex/.claude links, real directories, legacy copies and backups are user-owned.
  // Runtime skill adapters use the authoritative resolver; no compatibility link replacement is needed.
  return { copied, refreshed: refreshedPaths.length, refreshedPaths, retiredSkills: [], retiredRegistries: [],
    skillSources: { builtin: "release/skills", user: "skills", userDirectoriesPreserved: true } };
}

function refreshDefaultGuide(source: string, target: string, releaseRoot: string) {
  const baselinePath = path.join(releaseRoot, "registry", "legacy-builtin-skills.json");
  if (!fs.existsSync(baselinePath)) return false;
  const document = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const baseline = document.schemaVersion === 1 && document.guides?.find((entry) => entry.path === "AGENTS.md");
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  const sourceStat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!baseline || !stat?.isFile() || stat.isSymbolicLink() || !sourceStat?.isFile() || sourceStat.isSymbolicLink()) return false;
  const fd = fs.openSync(target, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || !opened.isFile()) return false;
    const previous = fs.readFileSync(fd);
    if (previous.length !== baseline.bytes || crypto.createHash("sha256").update(previous).digest("hex") !== baseline.sha256) return false;
    const next = fs.readFileSync(source);
    if (previous.equals(next)) return false;
    fs.writeSync(fd, next, 0, next.length, 0);
    fs.ftruncateSync(fd, next.length);
    return true;
  } finally { fs.closeSync(fd); }
}

export function copyMissingTree(source: string, target: string): number {
  const sourceStat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat || sourceStat.isSymbolicLink()) return 0;
  const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStat?.isSymbolicLink()) return 0;
  if (!targetStat) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (sourceStat.isDirectory()) fs.mkdirSync(target, { recursive: true });
    else { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); return 1; }
  }
  if (!sourceStat.isDirectory() || (targetStat && !targetStat.isDirectory())) return 0;
  let copied = 0;
  for (const entry of fs.readdirSync(source)) {
    // A mutable registry cannot claim ownership of the release's builtin skills or old Agent presets.
    if (["skills.json", "agents.json", "legacy-builtin-skills.json"].includes(entry)) continue;
    copied += copyMissingTree(path.join(source, entry), path.join(target, entry));
  }
  return copied;
}
