import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const exists = (file) => fs.existsSync(path.join(root, file));
export const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
export const executable = (file) => process.platform === 'win32' || (fs.statSync(path.join(root, file)).mode & 0o111) !== 0;
export function trackedFiles() {
  try { return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean); }
  catch { return walk(root).map((file) => path.relative(root, file).split(path.sep).join('/')).filter((file) => !file.startsWith('node_modules/') && !file.startsWith('.local/')); }
}
export function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.local', 'dist', 'secrets'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(file)); else if (entry.isFile()) output.push(file);
  }
  return output;
}
export function report(checks) {
  for (const check of checks) console.log(`${check.ok ? '[OK]' : check.warn ? '[WARN]' : '[FAIL]'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
  const failed = checks.filter((check) => !check.ok && !check.warn);
  if (failed.length) process.exit(1);
  console.log(`OK: ${checks.length} checks`);
}
