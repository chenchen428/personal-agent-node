import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

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

export function resolveFromCwd(value) {
  return path.resolve(process.cwd(), String(value || '.'));
}

export function relativeToRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative.startsWith('..') ? filePath : relative.split(path.sep).join('/');
}

export function writeText(filePath, content, { force = false } = {}) {
  if (fs.existsSync(filePath) && !force) throw new Error(`Refusing to overwrite ${relativeToRoot(filePath)} without --force`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function slugify(value) {
  const slug = String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'untitled';
}

export function emit(value, options = {}) {
  console.log(options.json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

export function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === '') throw new Error(`Missing required option --${name}`);
  return String(value);
}

export function timestamp() {
  return new Date().toISOString();
}
