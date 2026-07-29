#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const tag = String(args.tag || '');
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('--tag must be a versioned GitHub Release tag');
const output = path.resolve(args.output || path.join(root, 'dist', 'linux-install'));
const template = fs.readFileSync(path.join(root, 'scripts', 'templates', 'install-linux.sh'), 'utf8');
const rendered = template.replaceAll('__PERSONAL_AGENT_TAG__', tag);
if (rendered.includes('__PERSONAL_AGENT_TAG__')) throw new Error('Linux installer template still contains an unresolved release tag');
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, 'personal-agent-node-install.sh');
fs.writeFileSync(target, rendered, { mode: 0o755 });
process.stdout.write(`${JSON.stringify({ ok: true, tag, asset: target })}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') parsed.tag = argv[++index];
    else if (argv[index] === '--output') parsed.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return parsed;
}
