import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseOptions(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const separator = arg.indexOf('=');
    const key = arg.slice(2, separator === -1 ? undefined : separator);
    let value = separator === -1 ? undefined : arg.slice(separator + 1);
    if (value === undefined && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined) value = true;
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  }
  return { options, positionals };
}

export function relativeToRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative.startsWith('..') ? filePath : relative.split(path.sep).join('/');
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function emit(value, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}
