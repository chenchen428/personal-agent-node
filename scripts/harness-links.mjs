import fs from 'node:fs';
import path from 'node:path';

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
    try { fileSystem.rmSync(linkPath, { recursive: false, force: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const type = platform === 'win32' ? (spec.kind === 'dir' ? 'junction' : 'file') : spec.kind;
    const target = platform === 'win32' && spec.kind === 'dir'
      ? path.resolve(path.dirname(linkPath), spec.target)
      : spec.target;
    fileSystem.symlinkSync(target, linkPath, type);
  }
  return verifyHarnessLinks(root, { fileSystem });
}

export function verifyHarnessLinks(root, { fileSystem = fs } = {}) {
  const verified = [];
  for (const spec of harnessLinks) {
    const linkPath = path.join(root, spec.link);
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
