#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanSupplyChainText, securityScannerSelfChecks } from './skill-tree/security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const mode = args.staged ? 'staged' : args.working ? 'working' : 'all';
const checks = [];
const catalogPath = path.join(root, 'registry', 'skills.json');

addCheck('skill catalog exists', fs.existsSync(catalogPath), 'registry/skills.json');
if (!fs.existsSync(catalogPath)) finish();

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  addCheck('skill catalog JSON', true, 'registry/skills.json');
} catch (error) {
  addCheck('skill catalog JSON', false, error.message);
  finish();
}

const allowedMaturity = new Set(['stable', 'beta', 'experimental']);
const allowedRisks = new Set(['network-read', 'local-write', 'credentials', 'browser-session', 'external-generation', 'external-write']);
const allowedOrigins = new Set(['workspace', 'promoted', 'adapted']);
const allowedDecisions = new Set(['merged', 'deferred', 'excluded', 'retained']);
const allowedNetwork = new Set(['none', 'read', 'write']);
const allowedDataClass = new Set(['public', 'mixed', 'private']);
const allowedOutboundData = new Set(['none', 'query', 'content']);
const allowedCliKinds = new Set(['skill-script', 'workspace-cli', 'external-cli']);
const categories = new Map();
const skills = new Map();
const cliCapabilities = new Map();

for (const category of catalog.categories || []) {
  addCheck(`category id: ${category.id || '<missing>'}`, Boolean(category.id), 'registry/skills.json');
  addCheck(`category unique: ${category.id}`, !categories.has(category.id), 'registry/skills.json');
  addCheck(`category label: ${category.id}`, Boolean(category.label), category.label || 'missing');
  addCheck(`category order: ${category.id}`, Number.isInteger(category.order), String(category.order ?? 'missing'));
  categories.set(category.id, category);
}

for (const capability of catalog.cliCapabilities || []) {
  addCheck(`CLI capability name: ${capability.name || '<missing>'}`, Boolean(capability.name), 'registry/skills.json');
  addCheck(`CLI capability unique: ${capability.name}`, !cliCapabilities.has(capability.name), 'registry/skills.json');
  addCheck(`CLI capability category: ${capability.name}`, categories.has(capability.category), capability.category || 'missing');
  addCheck(`CLI capability kind: ${capability.name}`, allowedCliKinds.has(capability.kind), capability.kind || 'missing');
  addCheck(`CLI capability owner: ${capability.name}`, Boolean(capability.owner), capability.owner || 'missing');
  addCheck(`CLI capability entrypoint: ${capability.name}`, Boolean(capability.entrypoint), capability.entrypoint || 'missing');
  addCheck(`CLI capability command: ${capability.name}`, Boolean(capability.command), capability.command || 'missing');
  cliCapabilities.set(capability.name, capability);
}

for (const skill of catalog.skills || []) {
  const name = skill.name || '<missing>';
  addCheck(`catalog skill name: ${name}`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name || ''), 'lowercase hyphen-case required');
  addCheck(`catalog skill unique: ${name}`, !skills.has(name), 'registry/skills.json');
  addCheck(`catalog skill directory: ${name}`, skill.directory === `skills/${name}`, skill.directory || 'missing');
  addCheck(`catalog skill category: ${name}`, categories.has(skill.category), skill.category || 'missing');
  addCheck(`catalog skill maturity: ${name}`, allowedMaturity.has(skill.maturity), skill.maturity || 'missing');
  addCheck(`catalog skill risks: ${name}`, Array.isArray(skill.risks) && skill.risks.every((risk) => allowedRisks.has(risk)), (skill.risks || []).join(', '));
  const security = skill.security || {};
  addCheck(`skill security network: ${name}`, allowedNetwork.has(security.network), security.network || 'missing');
  addCheck(`skill security data class: ${name}`, allowedDataClass.has(security.dataClass), security.dataClass || 'missing');
  addCheck(`skill security outbound data: ${name}`, allowedOutboundData.has(security.outboundData), security.outboundData || 'missing');
  addCheck(`skill security external write: ${name}`, typeof security.externalWrite === 'boolean', String(security.externalWrite ?? 'missing'));
  addCheck(`skill security authorization: ${name}`, typeof security.requiresAuthorization === 'boolean', String(security.requiresAuthorization ?? 'missing'));
  addCheck(`skill security untrusted content: ${name}`, typeof security.untrustedContent === 'boolean', String(security.untrustedContent ?? 'missing'));
  const risks = new Set(skill.risks || []);
  if (risks.has('network-read')) {
    addCheck(`network-read declaration: ${name}`, ['read', 'write'].includes(security.network), security.network || 'missing');
    addCheck(`network content boundary: ${name}`, security.untrustedContent === true, 'untrustedContent must be true');
  }
  if (risks.has('browser-session')) addCheck(`browser content boundary: ${name}`, security.untrustedContent === true, 'untrustedContent must be true');
  if (risks.has('external-generation')) {
    addCheck(`generation network declaration: ${name}`, security.network === 'write' && security.outboundData === 'content', `${security.network}/${security.outboundData}`);
    addCheck(`generation authorization: ${name}`, security.requiresAuthorization === true, 'requiresAuthorization must be true');
  }
  if (risks.has('external-write')) {
    addCheck(`external-write declaration: ${name}`, security.network === 'write' && security.externalWrite === true, `${security.network}/${security.externalWrite}`);
    addCheck(`external-write authorization: ${name}`, security.requiresAuthorization === true, 'requiresAuthorization must be true');
    addCheck(`external-write confirmation: ${name}`, security.requiresFinalConfirmation === true, 'requiresFinalConfirmation must be true');
  }
  if (risks.has('credentials')) addCheck(`credential data class: ${name}`, ['mixed', 'private'].includes(security.dataClass), security.dataClass || 'missing');
  addCheck(`catalog skill origin: ${name}`, allowedOrigins.has(skill.origin?.kind), skill.origin?.kind || 'missing');
  addCheck(`catalog skill license: ${name}`, Boolean(skill.origin?.license), skill.origin?.license || 'missing');
  if (skill.origin?.kind === 'adapted') {
    addCheck(`adapted repository: ${name}`, /^https:\/\/github\.com\//.test(skill.origin.repository || ''), skill.origin.repository || 'missing');
    addCheck(`adapted revision: ${name}`, /^[0-9a-f]{40}$/.test(skill.origin.revision || ''), skill.origin.revision || 'missing');
  }
  addCheck(`catalog skill CLI list: ${name}`, Array.isArray(skill.cli), 'cli must be an array');
  addCheck(`catalog skill examples: ${name}`, Array.isArray(skill.examples), 'examples must be an array');
  addCheck(`catalog skill related: ${name}`, Array.isArray(skill.related), 'related must be an array');
  skills.set(name, skill);
}

for (const skill of skills.values()) {
  for (const cli of skill.cli || []) {
    const capability = cliCapabilities.get(cli);
    addCheck(`skill CLI registered: ${skill.name} -> ${cli}`, Boolean(capability), cli);
    if (capability) addCheck(`skill owns CLI: ${skill.name} -> ${cli}`, capability.owner === skill.name, capability.owner || 'missing');
  }
  for (const related of skill.related || []) addCheck(`related skill exists: ${skill.name} -> ${related}`, skills.has(related), related);
  if (skill.caseRequired) addCheck(`required case registered: ${skill.name}`, skill.examples.length > 0, 'examples');
  for (const example of skill.examples || []) addCheck(`case file exists: ${skill.name}`, fs.existsSync(path.join(root, example)), example);
}

for (const capability of cliCapabilities.values()) {
  const entrypoint = path.resolve(root, capability.entrypoint || '');
  const relativeEntrypoint = path.relative(root, entrypoint).split(path.sep).join('/');
  addCheck(`CLI entrypoint exists: ${capability.name}`, fs.existsSync(entrypoint), capability.entrypoint || 'missing');
  if (capability.kind === 'skill-script') {
    addCheck(`CLI owner exists: ${capability.name}`, skills.has(capability.owner), capability.owner || 'missing');
    addCheck(
      `CLI implementation owned by skill: ${capability.name}`,
      relativeEntrypoint.startsWith(`skills/${capability.owner}/scripts/`),
      relativeEntrypoint,
    );
    const executable = isExecutable(entrypoint);
    addCheck(`CLI entrypoint executable: ${capability.name}`, executable, relativeEntrypoint);
  } else if (capability.kind === 'external-cli') {
    addCheck(`external CLI owner exists: ${capability.name}`, skills.has(capability.owner), capability.owner || 'missing');
    addCheck(`external CLI documented by skill: ${capability.name}`, relativeEntrypoint.startsWith(`skills/${capability.owner}/`), relativeEntrypoint);
  } else {
    addCheck(`workspace CLI owner: ${capability.name}`, capability.owner === 'workspace', capability.owner || 'missing');
    addCheck(`workspace CLI stays outside skills: ${capability.name}`, relativeEntrypoint.startsWith('scripts/'), relativeEntrypoint);
  }
}

const skillsDir = path.join(root, 'skills');
const diskSkillNames = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

for (const name of diskSkillNames) addCheck(`skill cataloged: ${name}`, skills.has(name), 'registry/skills.json');
for (const name of skills.keys()) addCheck(`catalog skill directory: ${name}`, diskSkillNames.includes(name), `skills/${name}`);

for (const name of diskSkillNames) validateSkill(name);
validateUpstreams();
validateNoNestedRepositories();
validateNoSecretFiles();
validateSecurityScan();

if (mode !== 'all') {
  const changedFiles = collectChangedFiles(mode);
  addCheck(`changed skill files inspected (${mode})`, true, String(changedFiles.filter(isSkillTreeFile).length), 'warn');
}

finish();

function validateSkill(name) {
  const skillDir = path.join(skillsDir, name);
  const manifest = path.join(skillDir, 'SKILL.md');
  addCheck(`skill manifest: ${name}`, fs.existsSync(manifest), `skills/${name}/SKILL.md`);
  if (!fs.existsSync(manifest)) return;
  const content = fs.readFileSync(manifest, 'utf8');
  const frontmatter = parseFrontmatter(content);
  addCheck(`skill frontmatter: ${name}`, Boolean(frontmatter), 'opening and closing --- required');
  if (frontmatter) {
    addCheck(`skill name matches directory: ${name}`, frontmatter.values.name === name, frontmatter.values.name || 'missing');
    addCheck(`skill description: ${name}`, Boolean(frontmatter.values.description?.trim()), 'description required');
    const extraKeys = frontmatter.keys.filter((key) => !['name', 'description'].includes(key));
    addCheck(`skill frontmatter keys: ${name}`, extraKeys.length === 0, extraKeys.join(', ') || 'name, description');
  }
  addCheck(`skill has no TODO: ${name}`, !/\bTODO\b/.test(content), 'remove scaffold placeholders');
  const lineCount = content.split(/\r?\n/).length;
  addCheck(`skill length: ${name}`, lineCount <= 800, `${lineCount} lines (max 800)`);

  const openaiYaml = path.join(skillDir, 'agents', 'openai.yaml');
  addCheck(`skill UI metadata: ${name}`, fs.existsSync(openaiYaml), `skills/${name}/agents/openai.yaml`);
  if (fs.existsSync(openaiYaml)) {
    const yaml = fs.readFileSync(openaiYaml, 'utf8');
    addCheck(`skill UI display name: ${name}`, /^\s*display_name:\s*["'].+["']\s*$/m.test(yaml), 'interface.display_name');
    addCheck(`skill UI short description: ${name}`, /^\s*short_description:\s*["'].{25,64}["']\s*$/m.test(yaml), '25-64 chars');
    addCheck(`skill UI default prompt: ${name}`, yaml.includes(`$${name}`), `default_prompt must mention $${name}`);
  }

  for (const target of markdownTargets(content)) {
    if (/^(https?:|mailto:|#|\/)/.test(target) || /[{}<>]/.test(target)) continue;
    const relativeTarget = decodeURIComponent(target.split('#')[0]);
    if (!relativeTarget) continue;
    const resolved = path.resolve(skillDir, relativeTarget);
    const insideSkill = resolved === skillDir || resolved.startsWith(`${skillDir}${path.sep}`);
    addCheck(`skill link stays local: ${name}`, insideSkill, target);
    if (insideSkill) addCheck(`skill link exists: ${name}`, fs.existsSync(resolved), target);
  }
}

function validateUpstreams() {
  const upstreamIds = new Set();
  for (const upstream of catalog.upstreams || []) {
    addCheck(`upstream unique: ${upstream.id || '<missing>'}`, Boolean(upstream.id) && !upstreamIds.has(upstream.id), upstream.repository || 'missing');
    upstreamIds.add(upstream.id);
    addCheck(`upstream repository: ${upstream.id}`, /^https:\/\/github\.com\//.test(upstream.repository || ''), upstream.repository || 'missing');
    addCheck(`upstream revision: ${upstream.id}`, /^[0-9a-f]{40}$/.test(upstream.revision || ''), upstream.revision || 'missing');
    addCheck(`upstream license: ${upstream.id}`, Boolean(upstream.license), upstream.license || 'missing');
    const mapped = new Set();
    for (const mapping of upstream.mappings || []) {
      addCheck(`upstream source unique: ${upstream.id}/${mapping.source}`, Boolean(mapping.source) && !mapped.has(mapping.source), mapping.source || 'missing');
      mapped.add(mapping.source);
      addCheck(`upstream decision: ${upstream.id}/${mapping.source}`, allowedDecisions.has(mapping.decision), mapping.decision || 'missing');
      addCheck(`upstream targets: ${upstream.id}/${mapping.source}`, Array.isArray(mapping.targets) && mapping.targets.every((target) => skills.has(target)), (mapping.targets || []).join(', '));
      if (mapping.decision === 'merged' || mapping.decision === 'retained') {
        addCheck(`upstream mapped target: ${upstream.id}/${mapping.source}`, mapping.targets.length > 0, 'merged/retained needs a target');
      }
      if (mapping.decision === 'deferred' || mapping.decision === 'excluded') {
        addCheck(`upstream decision reason: ${upstream.id}/${mapping.source}`, Boolean(mapping.reason), mapping.reason || 'missing');
      }
    }
  }
}

function validateNoNestedRepositories() {
  const found = [];
  walk(skillsDir, (fullPath, entry) => {
    if (entry.isDirectory() && entry.name === '.git') found.push(path.relative(root, fullPath));
  });
  addCheck('no nested skill repositories', found.length === 0, found.join(', ') || 'skills/**/.git absent');
}

function validateNoSecretFiles() {
  const found = [];
  walk(skillsDir, (fullPath, entry) => {
    if (entry.isFile() && (entry.name === '.env' || entry.name === 'auth.json' || /private.*key/i.test(entry.name))) {
      found.push(path.relative(root, fullPath));
    }
  });
  addCheck('no skill secret files', found.length === 0, found.join(', ') || 'no .env/auth/private keys');
}

function validateSecurityScan() {
  const findings = {
    promptInjection: [],
    secretAccess: [],
    outboundUpload: [],
    exfilHost: [],
    unicodeControls: [],
    installHooks: [],
    escapingSymlinks: [],
    oversizedFiles: [],
  };
  const scanRoots = [skillsDir, path.join(root, 'scripts', 'skill-tree'), path.join(root, 'scripts', 'skill-tree.mjs')];
  const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash', '.html', '.css', '.toml']);
  const executableExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash']);

  for (const scanRoot of scanRoots) {
    if (!fs.existsSync(scanRoot)) continue;
    const stats = fs.lstatSync(scanRoot);
    if (stats.isFile()) inspectFile(scanRoot);
    else walk(scanRoot, (fullPath, entry) => {
      if (entry.isSymbolicLink()) {
        let resolved;
        try {
          resolved = fs.realpathSync(fullPath);
        } catch {
          findings.escapingSymlinks.push(`${path.relative(root, fullPath)} (broken)`);
          return;
        }
        if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
          findings.escapingSymlinks.push(`${path.relative(root, fullPath)} -> ${resolved}`);
        }
        return;
      }
      if (entry.isFile()) inspectFile(fullPath);
    });
  }

  function inspectFile(fullPath) {
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    if (relative === 'scripts/skill-tree/security.mjs') return;
    const stats = fs.statSync(fullPath);
    if (stats.size > 5 * 1024 * 1024) findings.oversizedFiles.push(`${relative} (${stats.size} bytes)`);
    const extension = path.extname(fullPath).toLowerCase();
    if (!textExtensions.has(extension)) return;
    const text = fs.readFileSync(fullPath, 'utf8');
    const scan = scanSupplyChainText(text, { executable: executableExtensions.has(extension) });
    if (scan.unicodeControls) findings.unicodeControls.push(relative);
    if (scan.exfilHost) findings.exfilHost.push(relative);
    if (scan.promptInjection) findings.promptInjection.push(relative);
    if (scan.secretAccess) findings.secretAccess.push(relative);
    if (scan.outboundUpload) findings.outboundUpload.push(relative);
    if (path.basename(fullPath) === 'package.json') {
      try {
        const packageJson = JSON.parse(text);
        const lifecycle = ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare'].filter((name) => packageJson.scripts?.[name]);
        if (lifecycle.length) findings.installHooks.push(`${relative}: ${lifecycle.join(', ')}`);
      } catch {
        findings.installHooks.push(`${relative}: invalid JSON`);
      }
    }
  }

  addCheck('security scan: prompt injection directives', findings.promptInjection.length === 0, findings.promptInjection.join(', ') || 'none');
  addCheck('security scan: secret path access', findings.secretAccess.length === 0, findings.secretAccess.join(', ') || 'none');
  addCheck('security scan: suspicious upload commands', findings.outboundUpload.length === 0, findings.outboundUpload.join(', ') || 'none');
  addCheck('security scan: temporary exfiltration hosts', findings.exfilHost.length === 0, findings.exfilHost.join(', ') || 'none');
  addCheck('security scan: Unicode control characters', findings.unicodeControls.length === 0, findings.unicodeControls.join(', ') || 'none');
  addCheck('security scan: install lifecycle hooks', findings.installHooks.length === 0, findings.installHooks.join(', ') || 'none');
  addCheck('security scan: escaping symlinks', findings.escapingSymlinks.length === 0, findings.escapingSymlinks.join(', ') || 'none');
  addCheck('security scan: oversized files', findings.oversizedFiles.length === 0, findings.oversizedFiles.join(', ') || 'none');
  for (const selfCheck of securityScannerSelfChecks()) {
    addCheck(`security scanner self-test: ${selfCheck.name}`, selfCheck.detected, 'representative malicious fixture must be detected');
  }
}

function isExecutable(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  if (process.platform !== 'win32') return (fs.statSync(filePath).mode & 0o111) !== 0;
  return fs.readFileSync(filePath, 'utf8').startsWith('#!');
}

function parseFrontmatter(content) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const keys = [];
  const values = {};
  let currentKey = null;
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      keys.push(currentKey);
      values[currentKey] = ['>', '|', '>-', '|-'].includes(match[2].trim()) ? '' : stripQuotes(match[2].trim());
    } else if (currentKey && /^\s+/.test(line)) {
      values[currentKey] = `${values[currentKey]} ${line.trim()}`.trim();
    }
  }
  return { keys, values };
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function markdownTargets(content) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(pattern)) targets.push(match[1].trim().replace(/^<|>$/g, ''));
  return targets;
}

function walk(directory, visitor) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    visitor(fullPath, entry);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') walk(fullPath, visitor);
  }
}

function collectChangedFiles(changeMode) {
  const files = new Set();
  const args = changeMode === 'staged' ? ['diff', '--cached', '--name-only', '--diff-filter=ACMRD'] : ['diff', '--name-only', '--diff-filter=ACMRD'];
  for (const file of gitLines(args)) files.add(file);
  if (changeMode === 'working') for (const file of gitLines(['ls-files', '--others', '--exclude-standard'])) files.add(file);
  return [...files].sort();
}

function gitLines(gitArgs) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...gitArgs], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function isSkillTreeFile(file) {
  return file.startsWith('skills/')
    || file.startsWith('test/fixtures/skill-cases/')
    || file.startsWith('scripts/skill-tree')
    || file === 'scripts/skill-guard.mjs'
    || file === 'registry/skills.json'
    || file === 'docs/skills.md'
    || file === 'AGENTS.md';
}

function addCheck(name, ok, detail = '', severity = 'error') {
  checks.push({ name, ok: Boolean(ok), detail, severity });
}

function finish() {
  const failed = checks.filter((check) => !check.ok && check.severity !== 'warn').length;
  const warned = checks.filter((check) => !check.ok && check.severity === 'warn').length;
  if (args.json) {
    const failedChecks = checks.filter((check) => !check.ok);
    process.stdout.write(`${JSON.stringify({ mode, total: checks.length, failed, warned, checks: failedChecks }, null, 2)}\n`);
  }
  else {
    for (const check of checks) {
      const status = check.ok ? 'OK ' : check.severity === 'warn' ? 'WARN' : 'FAIL';
      console.log(`[${status}] ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
    }
    if (failed) console.error(`skill-guard failed: ${failed} check(s) failed`);
    else console.log(`skill-guard passed: ${checks.length} checks, ${warned} warning(s)`);
  }
  process.exit(failed ? 1 : 0);
}

function parseArgs(argv) {
  return {
    staged: argv.includes('--staged'),
    working: argv.includes('--working'),
    json: argv.includes('--json'),
  };
}
