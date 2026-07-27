#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptRoot, '..');
const workspaceRoot = path.resolve(skillRoot, '..', '..');
const assetsRoot = path.join(skillRoot, 'assets');
const expectedVersions = {
  '@pascal-app/core': '0.9.2',
  '@pascal-app/viewer': '0.9.2',
  '@pascal-app/mcp': '0.3.2',
};
const bundledRuntimeVersions = {
  '@modelcontextprotocol/sdk': '1.29.0',
  react: '19.2.7',
  'react-dom': '19.2.7',
  zod: '3.25.76',
  three: '0.185.0',
  '@react-three/fiber': '9.5.0',
  '@react-three/drei': '10.7.7',
};

for (const [name, expected] of Object.entries({ ...expectedVersions, ...bundledRuntimeVersions })) {
  const actual = readPackageVersion(name);
  if (actual !== expected) throw new Error(`${name} must be exactly ${expected}; found ${actual}`);
}

fs.mkdirSync(assetsRoot, { recursive: true });
const headlessOutput = path.join(assetsRoot, 'pascal-headless.bundle');
const viewerOutput = path.join(assetsRoot, 'pascal-viewer.bundle');

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [path.join(scriptRoot, 'pascal-runtime-entry.mjs')],
  outfile: headlessOutput,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  external: ['bun:sqlite'],
});

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [path.join(scriptRoot, 'pascal-page-client.jsx')],
  outfile: viewerOutput,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: Object.fromEntries([
    [['process', 'env', 'NODE_ENV'].join('.'), '"production"'],
    [['process', 'env', 'NEXT_PUBLIC_ASSETS_CDN_URL'].join('.'), '"#offline-assets-disabled"'],
    ['import.meta.url', 'document.baseURI'],
  ]),
  jsx: 'automatic',
});

const viewerSource = fs.readFileSync(viewerOutput, 'utf8')
  .replaceAll('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/', '#offline-basis/')
  .replaceAll('http://localhost', '#offline-localhost')
  .replaceAll('localhost', 'offline-host')
  .replaceAll('127.0.0.1', 'offline-ip');
fs.writeFileSync(viewerOutput, viewerSource);

const headless = fs.readFileSync(headlessOutput);
const viewer = fs.readFileSync(viewerOutput);
if (headless.includes(Buffer.from('bun:sqlite'))) throw new Error('headless bundle must not include bun:sqlite');
if (viewer.includes(Buffer.from('editor.pascal.app'))) throw new Error('viewer bundle must not include the Pascal CDN');
if (viewer.includes(Buffer.from('cdn.jsdelivr.net'))) throw new Error('viewer bundle must not include a remote decoder CDN');
if (viewer.includes(Buffer.from('localhost')) || viewer.includes(Buffer.from('127.0.0.1'))) {
  throw new Error('viewer bundle must not include loopback addresses');
}

const manifest = {
  schemaVersion: 1,
  adapterVersion: 1,
  nodeRuntime: '22',
  packages: Object.fromEntries(Object.entries({ ...expectedVersions, ...bundledRuntimeVersions }).map(([name, version]) => [name, {
    version,
    license: 'MIT',
    source: packageSource(name),
  }])),
  artifacts: {
    'pascal-headless.bundle': { bytes: headless.length, sha256: sha256(headless), target: 'node22-data-module' },
    'pascal-viewer.bundle': { bytes: viewer.length, sha256: sha256(viewer), target: 'browser-es2022' },
  },
  policies: {
    transport: 'in-memory-only',
    bunRequired: false,
    remoteAssets: false,
    visionTools: false,
  },
};
fs.writeFileSync(path.join(assetsRoot, 'pascal-runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, manifest }, null, 2)}\n`);

function readPackageVersion(name) {
  const packagePath = path.join(workspaceRoot, 'node_modules', ...name.split('/'), 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function packageSource(name) {
  if (name.startsWith('@pascal-app/')) return 'https://github.com/pascalorg/editor';
  if (name === '@modelcontextprotocol/sdk') return 'https://github.com/modelcontextprotocol/typescript-sdk';
  if (name === '@react-three/fiber') return 'https://github.com/pmndrs/react-three-fiber';
  if (name === '@react-three/drei') return 'https://github.com/pmndrs/drei';
  if (name === 'three') return 'https://github.com/mrdoob/three.js';
  if (name === 'zod') return 'https://github.com/colinhacks/zod';
  return 'https://github.com/facebook/react';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
