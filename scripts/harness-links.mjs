import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const harnessLinks = Object.freeze([
  { link: 'CLAUDE.md', target: 'AGENTS.md', kind: 'file' },
  { link: '.agents/skills', target: '../skills', kind: 'dir' },
  { link: '.claude/skills', target: '../skills', kind: 'dir' },
  { link: '.codex/skills', target: '../skills', kind: 'dir' },
  { link: '.cursor/skills', target: '../skills', kind: 'dir' },
]);

export function materializeHarnessLinks(root, { platform = process.platform, fileSystem = fs } = {}) {
  for (const spec of harnessLinks) {
    const linkPath = path.join(root, spec.link);
    fileSystem.mkdirSync(path.dirname(linkPath), { recursive: true });
    removeExistingBridge(linkPath, fileSystem);
    if (platform === 'win32' && spec.kind === 'file') {
      fileSystem.linkSync(path.resolve(path.dirname(linkPath), spec.target), linkPath);
      continue;
    }
    const type = platform === 'win32' ? 'junction' : spec.kind;
    const target = platform === 'win32' && spec.kind === 'dir'
      ? path.resolve(path.dirname(linkPath), spec.target)
      : spec.target;
    fileSystem.symlinkSync(target, linkPath, type);
  }
  return verifyHarnessLinks(root, { platform, fileSystem });
}

function removeExistingBridge(linkPath, fileSystem) {
  let stat;
  try { stat = fileSystem.lstatSync(linkPath); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || stat.isFile()) fileSystem.unlinkSync(linkPath);
  else if (stat.isDirectory()) fileSystem.rmSync(linkPath, { recursive: true, force: true });
  else throw new Error(`Unsupported Harness bridge entry: ${linkPath}`);
}

export function verifyHarnessLinks(root, { platform = process.platform, fileSystem = fs } = {}) {
  const verified = [];
  for (const spec of harnessLinks) {
    const linkPath = path.join(root, spec.link);
    if (platform === 'win32' && spec.kind === 'file') {
      const targetPath = path.resolve(path.dirname(linkPath), spec.target);
      const linkStat = fileSystem.statSync(linkPath, { bigint: true });
      const targetStat = fileSystem.statSync(targetPath, { bigint: true });
      if (!linkStat.isFile() || linkStat.dev !== targetStat.dev || linkStat.ino !== targetStat.ino || linkStat.nlink < 2n) {
        throw new Error(`Harness bridge must be a hard link to its target: ${spec.link}`);
      }
      verified.push({ ...spec, actual: spec.target });
      continue;
    }
    const stat = fileSystem.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) throw new Error(`Harness bridge must be a symbolic link: ${spec.link}`);
    const actual = fileSystem.readlinkSync(linkPath);
    const expectedResolved = path.resolve(path.dirname(linkPath), spec.target);
    const actualResolved = path.resolve(path.dirname(linkPath), actual);
    if (actualResolved !== expectedResolved) throw new Error(`Harness bridge target mismatch: ${spec.link} -> ${actual}`);
    verified.push({ ...spec, actual });
  }
  return verified;
}

if (isMain()) {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--force'].includes(mode)) throw new Error('Usage: harness-links.mjs [--check|--force]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const links = mode === '--force' ? materializeHarnessLinks(root) : verifyHarnessLinks(root);
  for (const link of links) process.stdout.write(`[OK] ${link.link} -> ${link.target}\n`);
}

function isMain() {
  try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
