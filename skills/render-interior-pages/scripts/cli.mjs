#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInteriorDeliveryContract } from '../../interior-design/scripts/page-assets.mjs';
import { readProject, resolveTrustedContext } from '../../interior-design/scripts/project-v2.mjs';
import { evaluateAgentReview, renderInteriorPages } from './renderer.mjs';

const rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const interiorSkillRoot = path.resolve(rendererRoot, '..', 'interior-design');
const [command = 'help', ...argv] = process.argv.slice(2);
const options = parse(argv);
try { if (command === 'render') render(); else if (command === 'review') review(); else help(); }
catch (error) { emit({ ok: false, error: { code: 'INTERIOR_PAGE_RENDER_FAILED', message: error.message } }); process.exitCode = 1; }

function render() {
  const context = resolveTrustedContext();
  const { projectDir, project } = readProject(required('project-dir'), context);
  const output = path.resolve(required('output'));
  if (!inside(path.resolve(projectDir, 'derived'), output)) throw new Error('Page output must stay inside the project derived directory');
  const result = renderInteriorPages({ projectDir, context, output, skillRoot: interiorSkillRoot, delivery: loadInteriorDeliveryContract(interiorSkillRoot) });
  emit({ ok: true, schemaVersion: 1, renderer: result.manifest.renderer, revision: project.revision, output: path.relative(projectDir, output), preview: { primary: 'index.html', specialistPages: { threeD: '3d/index.html' }, styleGuide: 'style-guide.json', selectedStyleId: result.manifest.style?.selectedStyleId }, agentReview: result.reviewPlan, totalBytes: result.totalBytes });
}
function review() { emit(evaluateAgentReview(path.resolve(required('bundle')), JSON.parse(fs.readFileSync(path.resolve(required('input')), 'utf8')))); }
function help() { emit({ ok: true, commands: ['render --project-dir <dir> --output <dir> --json', 'review --bundle <dir> --input <observations.json> --json'] }); }
function required(name) { const value = options[name]; if (!value) throw new Error(`--${name} is required`); return value; }
function emit(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function parse(values) { const result = {}; for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (!value.startsWith('--')) throw new Error(`unsupported argument: ${value}`); const key = value.slice(2); result[key] = key === 'json' ? true : values[++index]; } return result; }
