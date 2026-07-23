#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditModel, normalizeModel, validateModel } from './model.mjs';
import { generatePage, loadInteriorTemplateContract, loadSourcePlanAsset, verifyGeneratedPageHtml } from './generate-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...argv] = process.argv.slice(2);
const options = parse(argv);

try {
  if (command === 'validate') {
    const model = read(required(options.input, '--input'));
    const errors = validateModel(model);
    emit({ ok: errors.length === 0, errors });
    if (errors.length) process.exitCode = 1;
  } else if (command === 'normalize') {
    const input = read(required(options.input, '--input'));
    const errors = validateModel(input);
    if (errors.length) throw new Error(errors.join('\n'));
    const model = normalizeModel(input);
    const nextErrors = validateModel(model);
    if (nextErrors.length) throw new Error(nextErrors.join('\n'));
    writeJson(required(options.output, '--output'), model);
    emit({ ok: true, output: path.resolve(options.output), areaM2: model.project.areaM2, rooms: model.rooms.length });
  } else if (command === 'audit') {
    const model = read(required(options.input, '--input'));
    const report = auditModel(model);
    emit(report);
    if (!report.ok) process.exitCode = 1;
  } else if (command === 'page') {
    const template = loadInteriorTemplateContract(root);
    const requestedTemplate = options.template || template.id;
    if (requestedTemplate !== template.id) throw new Error(`--template must be ${template.id}`);
    const model = read(required(options.input, '--input'));
    const errors = validateModel(model);
    if (errors.length) throw new Error(errors.join('\n'));
    const report = auditModel(model);
    if (!report.ok) throw new Error(report.findings.map((item) => `${item.code}: ${item.message}`).join('\n'));
    const output = path.resolve(required(options.output, '--output'));
    const sourcePlan = loadSourcePlanAsset(required(options['source-plan'], '--source-plan'));
    const index = generatePage({ model, output, skillRoot: root, sourcePlan, template });
    const templateVerification = verifyGeneratedPageHtml(fs.readFileSync(index, 'utf8'), template);
    emit({ ok: true, output, index, template: templateVerification });
  } else {
    console.log('Usage: interior <validate|normalize|audit|page> --input <model.json> [--output <path>] [--template interior-design-delivery] [--source-plan <redacted-image>] [--json]');
  }
} catch (error) {
  if (options.json) emit({ ok: false, error: error.message });
  else console.error(`[interior-design] ${error.message}`);
  process.exitCode = 1;
}

function parse(args) { const out = {}; for (let i = 0; i < args.length; i += 1) { const key = args[i]; if (key === '--json') out.json = true; else if (key.startsWith('--')) out[key.slice(2)] = args[++i]; } return out; }
function required(value, flag) { if (!value) throw new Error(`${flag} is required`); return value; }
function read(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
function writeJson(file, value) { const target = path.resolve(file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); }
function emit(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
