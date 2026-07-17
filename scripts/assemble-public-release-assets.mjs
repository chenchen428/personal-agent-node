#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const tag = required(args.tag, '--tag');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (tag !== `v${metadata.version}`) throw new Error(`Release tag ${tag} does not match package version v${metadata.version}`);

const input = path.resolve(required(args.input, '--input'));
const output = path.resolve(required(args.output, '--output'));
const evidence = path.resolve(required(args.evidence, '--evidence'));
const sourceMetadata = path.resolve(required(args.sourceMetadata, '--source-metadata'));
const publicAssets = expectedAssets(tag);
const updaterAssets = expectedUpdaterAssets(tag);

resetDirectory(output);
resetDirectory(evidence);
for (const name of publicAssets) copyRequired(path.join(input, name), path.join(output, name));

const sums = publicAssets.map((name) => `${sha256(path.join(output, name))}  ${name}`).join('\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${sums}\n`);

const base = `personal-agent-node-${tag}-universal`;
for (const name of [`${base}-release-manifest.json`, `${base}-SBOM.cdx.json`]) {
  copyRequired(path.join(sourceMetadata, name), path.join(evidence, name));
}
fs.writeFileSync(path.join(evidence, 'PUBLIC-ASSETS.json'), `${JSON.stringify({ schemaVersion: 1, tag, customerAssets: [...publicAssets, 'SHA256SUMS'], updaterAssets }, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ ok: true, tag, customerAssets: [...publicAssets, 'SHA256SUMS'], updaterAssets, evidence }, null, 2)}\n`);

function expectedAssets(value) {
  return [
    `personal-agent-node-${value}-windows-x64-installer.exe`,
    `personal-agent-node-${value}-macos-x64.pkg`,
    `personal-agent-node-${value}-macos-arm64.pkg`,
    `personal-agent-node-${value}-linux-x64.tar.zst`,
    `personal-agent-node-${value}-linux-arm64.tar.zst`,
    ...expectedUpdaterAssets(value),
  ];
}

function expectedUpdaterAssets(value) {
  return [
    `personal-agent-node-${value}-windows-x64-updater.exe`,
    `personal-agent-node-${value}-macos-x64-updater`,
    `personal-agent-node-${value}-macos-arm64-updater`,
    `personal-agent-node-${value}-linux-x64-updater`,
    `personal-agent-node-${value}-linux-arm64-updater`,
  ];
}

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copyRequired(source, target) {
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Required release input is missing: ${source}`);
  fs.copyFileSync(source, target);
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function required(value, flag) { if (!value) throw new Error(`${flag} is required`); return value; }
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') parsed.tag = argv[++index];
    else if (argv[index] === '--input') parsed.input = argv[++index];
    else if (argv[index] === '--output') parsed.output = argv[++index];
    else if (argv[index] === '--evidence') parsed.evidence = argv[++index];
    else if (argv[index] === '--source-metadata') parsed.sourceMetadata = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return parsed;
}
