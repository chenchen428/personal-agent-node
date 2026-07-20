import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { expectedSharpPackages, overlaySharpNativeRuntime } from '../scripts/lib/platform-native-dependencies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('platform packaging replaces source-host Sharp packages with target-native packages', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-sharp-overlay-'));
  try {
    const workspaceRoot = path.join(temporary, 'workspace');
    const releaseRoot = path.join(temporary, 'release');
    const sourceRoot = path.join(workspaceRoot, 'node_modules', '@img');
    const targetRoot = path.join(releaseRoot, 'node_modules', '@img');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(path.join(targetRoot, 'sharp-linuxmusl-x64'), { recursive: true });
    fs.mkdirSync(path.join(targetRoot, 'colour'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'sharp-linuxmusl-x64', 'wrong-platform'), 'wrong');
    fs.writeFileSync(path.join(targetRoot, 'colour', 'preserved'), 'yes');

    const expected = expectedSharpPackages(process.platform, process.arch);
    for (const name of expected) {
      fs.mkdirSync(path.join(sourceRoot, name), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, name, 'target-platform'), name);
    }

    const result = overlaySharpNativeRuntime({ workspaceRoot, releaseRoot, platform: process.platform, architecture: process.arch });
    assert.deepEqual(result.packages, expected);
    assert.equal(fs.existsSync(path.join(targetRoot, 'sharp-linuxmusl-x64')), false);
    assert.equal(fs.readFileSync(path.join(targetRoot, 'colour', 'preserved'), 'utf8'), 'yes');
    for (const name of expected) assert.equal(fs.readFileSync(path.join(targetRoot, name, 'target-platform'), 'utf8'), name);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('overlaid Sharp runtime loads and processes an image on the target platform', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-sharp-runtime-'));
  try {
    const releaseRoot = path.join(temporary, 'release');
    const targetModules = path.join(releaseRoot, 'node_modules');
    fs.mkdirSync(path.join(targetModules, '@img'), { recursive: true });
    fs.cpSync(path.join(root, 'node_modules', 'sharp'), path.join(targetModules, 'sharp'), { recursive: true });
    fs.cpSync(path.join(root, 'node_modules', 'detect-libc'), path.join(targetModules, 'detect-libc'), { recursive: true });
    fs.cpSync(path.join(root, 'node_modules', 'semver'), path.join(targetModules, 'semver'), { recursive: true });
    fs.cpSync(path.join(root, 'node_modules', '@img', 'colour'), path.join(targetModules, '@img', 'colour'), { recursive: true });
    fs.mkdirSync(path.join(targetModules, '@img', 'sharp-linux-x64'), { recursive: true });

    overlaySharpNativeRuntime({ workspaceRoot: root, releaseRoot, platform: process.platform, architecture: process.arch });
    const sharpRoot = path.join(targetModules, 'sharp');
    const probe = `const sharp=require(${JSON.stringify(sharpRoot)});sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer().then((value)=>{if(!Buffer.isBuffer(value)||value.length===0)process.exit(1)}).catch((error)=>{console.error(error);process.exit(1)})`;
    const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
