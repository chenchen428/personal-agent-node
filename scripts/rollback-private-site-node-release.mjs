#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const requestedInstallRoot = path.resolve(args.installRoot || path.join(os.homedir(), '.private-site-node'));
const installRoot = fs.realpathSync(requestedInstallRoot);
const current = path.join(installRoot, 'current');
const previous = path.join(installRoot, 'previous');
const currentTarget = target(current);
const previousTarget = target(previous);
if (!previousTarget) throw new Error(`No previous release is available under ${installRoot}`);
replace(current, previousTarget);
if (currentTarget && currentTarget !== previousTarget) replace(previous, currentTarget);
const manifest = JSON.parse(fs.readFileSync(path.join(previousTarget, 'release-manifest.json'), 'utf8'));
fs.writeFileSync(path.join(installRoot, 'installation.json'), `${JSON.stringify({ schemaVersion: 1, activeReleaseId: manifest.releaseId, revision: manifest.revision, rolledBackAt: new Date().toISOString(), current, previous: currentTarget || '' }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, releaseId: manifest.releaseId, installRoot, current: previousTarget, previous: currentTarget || '' }, null, 2));

function target(link) { try { return fs.realpathSync(link); } catch { return ''; } }
function replace(link, destination) {
  try { fs.rmSync(link, { force: true }); } catch {}
  fs.symlinkSync(process.platform === 'win32' ? destination : path.relative(path.dirname(link), destination), link, process.platform === 'win32' ? 'junction' : 'dir');
}
function parseArgs(argv) { const output = {}; for (let index = 0; index < argv.length; index += 1) if (argv[index] === '--install-root') output.installRoot = argv[++index]; return output; }
