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

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function parseFrontmatter(markdown) {
  const normalized = String(markdown).replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return { attributes: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { attributes: {}, body: normalized };
  const attributes = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    attributes[match[1]] = value;
  }
  return { attributes, body: normalized.slice(end + 5) };
}

export function firstHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

export function emit(value, options = {}) {
  console.log(options.json ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

export function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === '') throw new Error(`Missing required option --${name}`);
  return String(value);
}
