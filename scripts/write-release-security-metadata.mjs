#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const tag = required(args.tag, '--tag');
const output = path.resolve(required(args.output, '--output'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (tag !== `v${pkg.version}`) throw new Error(`Release tag ${tag} does not match package version v${pkg.version}`);
const prerelease = pkg.version.includes('-');
const document = {
  schemaVersion: 1,
  releaseTag: tag,
  prerelease,
  nativePlatformSigning: prerelease
    ? {
        required: false,
        status: 'deferred-prerelease',
        warning: 'Windows and macOS preview packages are not Authenticode or Developer ID signed. The operating system may require explicit user approval.',
      }
    : {
        required: true,
        status: 'required-and-enforced',
        warning: '',
      },
  verification: {
    sha256: true,
    sigstore: true,
    githubBuildProvenance: true,
    sbom: true,
  },
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${JSON.stringify({ ok: true, output, prerelease, nativeSigningRequired: !prerelease })}\n`);

function required(value, label) {
  if (!String(value || '').trim()) throw new Error(`${label} is required`);
  return String(value);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') output.tag = argv[++index];
    else if (argv[index] === '--output') output.output = argv[++index];
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  return output;
}
