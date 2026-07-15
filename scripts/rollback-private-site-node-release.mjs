#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const homeRoot = path.resolve(args.home || process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), '.personal-agent'));
const requestedInstallRoot = path.resolve(args.installRoot || path.join(homeRoot, 'core'));
const installRoot = fs.realpathSync(requestedInstallRoot);
const current = path.join(installRoot, 'current');
const previous = path.join(installRoot, 'previous');
const currentTarget = target(current);
const previousTarget = target(previous);
if (!previousTarget) throw new Error(`No previous release is available under ${installRoot}`);
replace(current, previousTarget);
if (currentTarget && currentTarget !== previousTarget) replace(previous, currentTarget);
const manifest = JSON.parse(fs.readFileSync(path.join(previousTarget, 'release-manifest.json'), 'utf8'));
const statePath = path.join(installRoot, 'installation.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
fs.writeFileSync(statePath, `${JSON.stringify({ ...state, schemaVersion: 2, activeReleaseId: manifest.releaseId, revision: manifest.revision, rolledBackAt: new Date().toISOString(), current, previous: currentTarget || '' }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, releaseId: manifest.releaseId, installRoot, current: previousTarget, previous: currentTarget || '' }, null, 2));

function target(link) { try { return fs.realpathSync(link); } catch { return ''; } }
function replace(link, destination) {
  try { fs.rmSync(link, { force: true }); } catch {}
  fs.symlinkSync(process.platform === 'win32' ? destination : path.relative(path.dirname(link), destination), link, process.platform === 'win32' ? 'junction' : 'dir');
}
function parseArgs(argv) { const output = {}; for (let index = 0; index < argv.length; index += 1) { if (argv[index] === '--install-root') output.installRoot = argv[++index]; else if (argv[index] === '--home') output.home = argv[++index]; } return output; }
