import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const HYPERFRAMES_VERSION = '0.7.82';
export const HYPERFRAMES_PACKAGE = `hyperframes@${HYPERFRAMES_VERSION}`;

const VALUE_OPTIONS = new Set([
  'project',
  'output',
  'quality',
  'fps',
  'workers',
  'samples',
  'at',
  'frames',
  'composition',
  'resolution',
  'crf',
  'video-bitrate',
]);

const BOOLEAN_OPTIONS = new Set([
  'force',
  'json',
  'strict',
  'at-transitions',
  'snapshots',
  'no-end',
  'no-best-effort',
]);

const ACTIONS = new Set(['doctor', 'check', 'snapshot', 'render']);

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw new Error(`Unsupported option: --${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

export function resolveProject(projectOption, cwd = process.cwd()) {
  if (!projectOption) throw new Error('--project is required');
  const project = path.resolve(cwd, projectOption);
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new Error(`Project directory does not exist: ${project}`);
  }
  if (!fs.existsSync(path.join(project, 'index.html'))) {
    throw new Error(`Project must contain index.html: ${project}`);
  }
  return fs.realpathSync(project);
}

export function resolveWithinProject(project, target, fallback) {
  const requested = target || fallback;
  const resolved = path.resolve(project, requested);
  const relative = path.relative(project, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Output must stay inside the project directory: ${requested}`);
  }
  assertNoSymlinkSegments(project, relative);
  return resolved;
}

export function buildInvocation(action, options, cwd = process.cwd()) {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported action: ${action || '<missing>'}`);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['--yes', HYPERFRAMES_PACKAGE, action];
  let project = null;

  if (action === 'doctor') {
    assertOnly(options, new Set(['json']), action);
    if (options.json) args.push('--json');
    return { command: npx, args, cwd, output: null };
  }

  project = resolveProject(options.project, cwd);
  if (action === 'check') {
    assertOnly(options, new Set([
      'project',
      'json',
      'strict',
      'at-transitions',
      'snapshots',
      'samples',
      'at',
    ]), action);
    addFlag(args, options, 'json');
    addFlag(args, options, 'strict');
    addFlag(args, options, 'at-transitions');
    addFlag(args, options, 'snapshots');
    addValue(args, options, 'samples');
    addValue(args, options, 'at');
    args.push(project);
    return { command: npx, args, cwd: project, output: null };
  }

  if (action === 'snapshot') {
    assertOnly(options, new Set(['project', 'output', 'frames', 'at', 'no-end', 'force']), action);
    const output = resolveWithinProject(project, options.output, 'snapshots');
    ensureWritableOutput(output, options.force);
    args.push('--output', output);
    addValue(args, options, 'frames');
    addValue(args, options, 'at');
    addFlag(args, options, 'no-end');
    args.push(project);
    return { command: npx, args, cwd: project, output };
  }

  assertOnly(options, new Set([
    'project',
    'output',
    'quality',
    'fps',
    'workers',
    'composition',
    'resolution',
    'crf',
    'video-bitrate',
    'strict',
    'no-best-effort',
    'force',
  ]), action);
  const defaultName = `${path.basename(project)}.mp4`;
  const output = resolveWithinProject(project, options.output, path.join('renders', defaultName));
  ensureWritableOutput(output, options.force);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  args.push('--output', output, '--skill', 'hyperframes-video');
  addValue(args, options, 'quality');
  addValue(args, options, 'fps');
  addValue(args, options, 'workers');
  addValue(args, options, 'composition');
  addValue(args, options, 'resolution');
  addValue(args, options, 'crf');
  addValue(args, options, 'video-bitrate');
  addFlag(args, options, 'strict');
  addFlag(args, options, 'no-best-effort');
  args.push(project);
  return { command: npx, args, cwd: project, output };
}

export function runHyperframes(action, options, runtime = {}) {
  const invocation = buildInvocation(action, options, runtime.cwd);
  const spawn = runtime.spawn || spawnSync;
  const result = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      HYPERFRAMES_NO_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return invocation;
}

function addValue(args, options, name) {
  if (options[name] !== undefined) args.push(`--${name}`, String(options[name]));
}

function addFlag(args, options, name) {
  if (options[name]) args.push(`--${name}`);
}

function ensureWritableOutput(output, force) {
  if (fs.existsSync(output) && !force) {
    throw new Error(`Output already exists; pass --force to replace it: ${output}`);
  }
}

function assertOnly(options, allowed, action) {
  const unsupported = Object.keys(options).filter((name) => !allowed.has(name));
  if (unsupported.length) {
    throw new Error(`${action} does not support: ${unsupported.map((name) => `--${name}`).join(', ')}`);
  }
}

function assertNoSymlinkSegments(project, relative) {
  let cursor = project;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Output path must not traverse a symbolic link: ${cursor}`);
    }
  }
}
