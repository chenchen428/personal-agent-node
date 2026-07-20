import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { validateCommandRegistry } from '../scripts/lib/command-registry-contract.mjs';
import { extractZipMember } from '../scripts/lib/zip-member.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) { return spawnSync(command, args, { cwd: root, encoding: 'utf8' }); }

test('customer Harness contains architecture registries and Agent guidance', () => {
  for (const file of ['AGENTS.md', 'docs/adr/0001-node-product-boundary-freeze.md', 'registry/projects.json', 'registry/skills.json', 'registry/behavior-baselines.json', 'registry/capabilities.json', 'registry/routes.json', 'registry/extensions.json', 'registry/commands.json', 'registry/product-development.json', 'schemas/personal-agent/product-development.schema.json', 'workflows/project-iteration.md', 'workflows/skill-iteration.md', 'workflows/product-development.md', 'skills/personal-agent/references/product-development.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test('installed product development is autonomous, private-root-only, and never targets current', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'registry/product-development.json'), 'utf8'));
  assert.equal(contract.mode, 'autonomous');
  assert.equal(contract.repository, 'chenchen428/personal-agent');
  assert.equal(contract.visibility, 'private');
  assert.equal(contract.confirmationPolicy, 'never');
  assert.equal(contract.cloneFailurePolicy, 'stop');
  assert.equal(contract.checkout.relativePath, 'projects/personal-agent');
  assert.equal(contract.immutableRuntimePath, 'core/current');
  assert.notEqual(contract.checkout.relativePath, contract.immutableRuntimePath);
  const workflow = fs.readFileSync(path.join(root, 'workflows/product-development.md'), 'utf8');
  for (const requirement of ['development ensure', 'private root', 'core/current', 'terminal', 'standing authority', 'self-iteration']) assert.match(workflow, new RegExp(requirement, 'i'));
});

test('customer Harness classifies and ships portable creation skills', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'registry/skills.json'), 'utf8'));
  const categories = new Set(catalog.categories.map((entry) => entry.id));
  const skills = new Map(catalog.skills.map((entry) => [entry.name, entry]));
  for (const category of ['writing-content', 'visual-media', 'travel-location', 'product-engineering']) assert.equal(categories.has(category), true, category);
  const expected = {
    'guizang-social-card-skill': ['visual-media', 'AGPL-3.0-only'],
    'guizang-ppt-skill': ['visual-media', 'AGPL-3.0-only'],
    'travel-guidebook': ['travel-location', 'MIT'],
    'frontend-design': ['product-engineering', 'Apache-2.0'],
    'ui-ux-pro-max': ['product-engineering', 'MIT'],
  };
  for (const [name, [category, license]] of Object.entries(expected)) {
    const skill = skills.get(name);
    assert.equal(skill?.category, category, name);
    assert.equal(skill?.origin?.license, license, name);
    assert.match(skill?.origin?.revision || '', /^[0-9a-f]{40}$/, name);
    assert.equal(skill?.caseRequired, true, name);
    assert.equal(fs.existsSync(path.join(root, `skills/${name}/SKILL.md`)), true, name);
    assert.equal(fs.existsSync(path.join(root, `skills/${name}/agents/openai.yaml`)), true, name);
  }
  for (const name of ['guizang-social-card-skill', 'guizang-ppt-skill']) {
    assert.equal(fs.existsSync(path.join(root, `skills/${name}/LICENSE`)), true, `${name} license`);
    assert.equal(fs.existsSync(path.join(root, `skills/${name}/NOTICE.md`)), true, `${name} notice`);
  }
  const build = fs.readFileSync(path.join(root, 'scripts/build-private-site-node-dist.mjs'), 'utf8');
  assert.match(build, /\["skills", "workspace\/skills"\]/);
});

test('customer Harness carries the portable Node acceptance standard', () => {
  const standard = fs.readFileSync(path.join(root, 'skills/personal-agent/references/acceptance.md'), 'utf8');
  for (const requirement of ['Node Core Gate', 'Optional Managed Cloud Integration', 'local-admin', 'ten minutes', 'previous-release rollback', 'public GitHub Release asset', '"route": "/app/chat"', '"uniquePrompt": true', '"realAgentRuntime": true', '"sameSessionAgentReply": true', '"wechatRequired": false', 'connections.wechat', 'optional evidence', 'Stable Go launchers', 'Setup Center']) assert.match(standard, new RegExp(requirement));
  assert.equal(fs.existsSync(path.join(root, 'test/fixtures/skill-cases/personal-agent-acceptance/case.json')), true);
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/skill-cases/personal-agent-acceptance/expected.json'), 'utf8'));
  assert.deepEqual(Object.keys(expected.node.webConversation), [
    'releaseAssetRuntime',
    'route',
    'authenticated',
    'uniquePrompt',
    'realAgentRuntime',
    'sameSessionAgentReply',
    'wechatRequired'
  ]);
  assert.equal(expected.node.webConversation.route, '/app/chat');
  assert.equal(expected.node.webConversation.wechatRequired, false);
  const releaseWorkflow = fs.readFileSync(path.join(root, 'workflows/release.md'), 'utf8');
  for (const requirement of ['Post-release Node gate', 'exact public asset', 'authenticated `/app/setup`', 'real Codex reply', 'same authenticated `/app/chat` session', '"wechatRequired": false']) assert.match(releaseWorkflow, new RegExp(requirement));
  const artifactVerifier = fs.readFileSync(path.join(root, 'scripts/verify-private-site-node-dist.mjs'), 'utf8');
  assert.match(artifactVerifier, /webConversation:\s*\{/);
  assert.match(artifactVerifier, /route: "\/app\/chat"/);
  assert.match(artifactVerifier, /realAgentRuntimeRequired: true/);
  assert.match(artifactVerifier, /sameSessionReplyRequired: true/);
  assert.match(artifactVerifier, /wechatRequired: false/);
});

test('seeded Node home links only to current path-based application routes', () => {
  const source = fs.readFileSync(path.join(root, 'core/runtime/bin/private-site.mjs'), 'utf8');
  for (const route of ['/app', '/app/chat', '/app/mail', '/app/files']) assert.match(source, new RegExp(`href="${route}"`));
  for (const legacy of ['/admin', '/agent', '/mail', '/files']) assert.doesNotMatch(source, new RegExp(`href="${legacy}"`));
});

test('Phase 0 behavior baseline registry and cases are complete', () => {
  const result = run(process.execPath, ['scripts/verify-behavior-baselines.mjs']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /9\/9/);
});

test('generated Agent compatibility bridges stay outside Git', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['.agents/', '.claude/', '.codex/', '.cursor/', 'CLAUDE.md']) assert.equal(ignore.includes(entry), true, entry);
});

test('public dependency metadata uses only the public npm registry', () => {
  const files = ['.npmrc', 'package-lock.json'];
  const forbiddenRegistry = ['registry', 'anpm', 'alibaba-inc', 'com'].join('.');
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(content.includes(forbiddenRegistry), false, file);
  }
  assert.match(fs.readFileSync(path.join(root, '.npmrc'), 'utf8'), /^registry=https:\/\/registry\.npmjs\.org\/$/m);
});

test('project, architecture, and skill guards pass', () => {
  for (const file of ['scripts/project-guard.mjs', 'scripts/architecture-guard.mjs', 'scripts/skill-guard.mjs']) {
    const result = run(process.execPath, [file, '--working']);
    assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`);
  }
});

test('skill cases are reproducible', () => {
  const result = run(process.execPath, ['scripts/skill-tree.mjs', 'cases', 'verify']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('cloud is optional in public project inventory', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry/projects.json'), 'utf8'));
  assert.equal(registry.projects.some((project) => /cloud/i.test(project.name)), false);
  assert.deepEqual(registry.projects.map((project) => project.name), ['personal-agent-node', 'private-site-edge']);
});

test('command registry validates against the public command schema', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry/commands.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/personal-agent/commands.schema.json'), 'utf8'));
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, 'registry/capabilities.json'), 'utf8'));
  const capabilityIds = new Set(capabilities.capabilities.map((entry) => entry.id));
  const valid = validateCommandRegistry({ registry, schema, capabilityIds });
  assert.equal(valid.ok, true, valid.errors.join('\n'));
  assert.deepEqual(registry.output.formats, ['json'], 'partial beta must not advertise unimplemented table or text output');

  const invalid = structuredClone(registry);
  invalid.implementationStatuses.preview.requiresPreviewFlag = false;
  assert.equal(validateCommandRegistry({ registry: invalid, schema, capabilityIds }).ok, false, 'contract must reject preview commands without explicit opt-in');

  const extraFields = structuredClone(registry);
  extraFields.undocumented = true;
  extraFields.output.undocumented = true;
  assert.equal(validateCommandRegistry({ registry: extraFields, schema, capabilityIds }).ok, false, 'contract must reject undocumented top-level and output fields');

  const invalidSchema = structuredClone(schema);
  invalidSchema.$defs.command.properties.implementationStatus.enum = ['implemented', 'planned'];
  assert.equal(validateCommandRegistry({ registry, schema: invalidSchema, capabilityIds }).ok, false, 'contract must reject a schema that omits preview');
});

test('GitHub release chain is version-gated and publishes verifiable artifacts', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/release-check.mjs', 'scripts/release-package.mjs', 'scripts/release-download.mjs', 'scripts/rollback-private-site-node-release.mjs', 'workflows/release.md']) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gate = run(process.execPath, ['scripts/release-check.mjs', '--tag', `v${pkg.version}`, '--allow-dirty']);
  assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);
  const bad = run(process.execPath, ['scripts/release-check.mjs', '--tag', 'v999.0.0', '--allow-dirty']);
  assert.notEqual(bad.status, 0);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  for (const requirement of [
    'NODE_VERSION: 22.23.1',
    'windows-2025',
    'macos-15-intel',
    'macos-15',
    'ubuntu-24.04',
    'ubuntu-24.04-arm',
    'include-hidden-files: true',
    '--require-signing',
    'WINDOWS_SIGNING_PFX_BASE64',
    'APPLE_INSTALLER_IDENTITY',
    'APPLE_NOTARY_KEY_BASE64',
    "!contains(github.ref_name, '-')",
    'REQUIRE_NATIVE_SIGNING',
    'RELEASE-SECURITY.json',
    'write-release-security-metadata.mjs',
    'assemble-public-release-assets.mjs',
    'dist/public-release/*',
    'name: release-evidence',
    'retention-days: 90',
    'cosign sign-blob',
    'actions/attest-build-provenance@v2',
  ]) assert.match(workflow, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(workflow, /files:\s*dist\/release\/\*/);
  assert.doesNotMatch(workflow, /dist\/public-release\/.*\.sigstore\.json/);
  const runtimeFetcher = fs.readFileSync(path.join(root, 'scripts/fetch-node-runtime.mjs'), 'utf8');
  assert.match(runtimeFetcher, /extractZipMember\(archive, descriptor\.member\)/);
  const platformBuilder = fs.readFileSync(path.join(root, 'scripts/build-platform-installer.mjs'), 'utf8');
  assert.match(platformBuilder, /path\.basename\(payload\).*cwd: temporary/);
  assert.match(platformBuilder, /packageUpdater/);
  assert.match(platformBuilder, /-updater/);
  assert.doesNotMatch(platformBuilder, /`\$\{asset\}\.sha256`|`\$\{updater\}\.sha256`/);
  assert.match(workflow, /matrix\.platform == 'darwin' && !contains\(github\.ref_name, '-'\).*personal-agent-notary\.p8/);
  const metadataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-release-security-'));
  try {
    const metadataFile = path.join(metadataRoot, 'RELEASE-SECURITY.json');
    const metadata = run(process.execPath, ['scripts/write-release-security-metadata.mjs', '--tag', `v${pkg.version}`, '--output', metadataFile]);
    assert.equal(metadata.status, 0, `${metadata.stdout}\n${metadata.stderr}`);
    const security = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    assert.equal(security.prerelease, true);
    assert.deepEqual(security.nativePlatformSigning, {
      required: false,
      status: 'deferred-prerelease',
      warning: 'Windows and macOS preview packages are not Authenticode or Developer ID signed. The operating system may require explicit user approval.',
    });
    assert.deepEqual(security.verification, { sha256: true, sigstore: true, githubBuildProvenance: true, sbom: true });
  } finally {
    fs.rmSync(metadataRoot, { recursive: true, force: true });
  }
});

test('public GitHub release keeps customer downloads concise and CI evidence separate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tag = `v${pkg.version}`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-public-release-'));
  const input = path.join(temporary, 'input');
  const source = path.join(temporary, 'source');
  const output = path.join(temporary, 'public');
  const evidence = path.join(temporary, 'evidence');
  fs.mkdirSync(input);
  fs.mkdirSync(source);
  const assets = [
    'personal-agent-relay-install.sh',
    `personal-agent-node-${tag}-windows-x64-installer.exe`,
    `personal-agent-node-${tag}-windows-x64-updater.exe`,
    `personal-agent-node-${tag}-macos-x64.pkg`,
    `personal-agent-node-${tag}-macos-x64-updater`,
    `personal-agent-node-${tag}-macos-arm64.pkg`,
    `personal-agent-node-${tag}-macos-arm64-updater`,
    `personal-agent-node-${tag}-linux-x64.tar.zst`,
    `personal-agent-node-${tag}-linux-x64-updater`,
    `personal-agent-node-${tag}-linux-arm64.tar.zst`,
    `personal-agent-node-${tag}-linux-arm64-updater`,
  ];
  try {
    for (const name of assets) fs.writeFileSync(path.join(input, name), name);
    fs.writeFileSync(path.join(source, `personal-agent-node-${tag}-universal-release-manifest.json`), '{}\n');
    fs.writeFileSync(path.join(source, `personal-agent-node-${tag}-universal-SBOM.cdx.json`), '{}\n');
    const assembled = run(process.execPath, ['scripts/assemble-public-release-assets.mjs', '--tag', tag, '--input', input, '--output', output, '--evidence', evidence, '--source-metadata', source]);
    assert.equal(assembled.status, 0, `${assembled.stdout}\n${assembled.stderr}`);
    assert.deepEqual(fs.readdirSync(output).sort(), [...assets, 'SHA256SUMS'].sort());
    assert.deepEqual(fs.readdirSync(evidence).sort(), [
      'PUBLIC-ASSETS.json',
      `personal-agent-node-${tag}-universal-SBOM.cdx.json`,
      `personal-agent-node-${tag}-universal-release-manifest.json`,
    ].sort());
    assert.equal(fs.readFileSync(path.join(output, 'SHA256SUMS'), 'utf8').trim().split('\n').length, assets.length);
    assert.equal(fs.readdirSync(output).some((name) => name.endsWith('.sha256') || name.endsWith('.sigstore.json') || name.includes('SBOM') || name.includes('manifest')), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('GitHub release builds one self-extracting Relay installer for a public Linux server', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tag = `v${pkg.version}`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-agent-relay-release-'));
  try {
    const built = run(process.execPath, ['scripts/build-self-hosted-relay-installer.mjs', '--tag', tag, '--output', temporary]);
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const asset = path.join(temporary, 'personal-agent-relay-install.sh');
    const source = fs.readFileSync(asset, 'utf8');
    assert.match(source, new RegExp(`Installing Personal Agent Relay ${tag.replaceAll('.', '\\.')}`));
    assert.match(source, /PERSONAL_AGENT_RELAY/);
    assert.match(source, /sudo bash personal-agent-relay-install\.sh <domain>/);
    assert.doesNotMatch(source, /core\/edge\/src\/self-hosted-relay\.ts/);
    const syntax = run('bash', ['-n', asset]);
    assert.equal(syntax.status, 0, `${syntax.stdout}\n${syntax.stderr}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Windows runtime extraction reads one verified ZIP member without tar or PowerShell', () => {
  const member = 'node-v22.23.1-win-x64/node.exe';
  const expected = Buffer.from('portable-node-runtime');
  const archive = zipWithDeflatedMember(member, expected);
  assert.deepEqual(extractZipMember(archive, member), expected);
  assert.throws(() => extractZipMember(archive, '../node.exe'), /unsafe/);
  const corrupted = Buffer.from(archive);
  corrupted[35 + Buffer.byteLength(member)] ^= 0xff;
  assert.throws(() => extractZipMember(corrupted, member), /invalid distance|invalid stored block|incorrect data|CRC mismatch|size mismatch/i);
});

function zipWithDeflatedMember(name, content) {
  const nameBytes = Buffer.from(name);
  const compressed = zlib.deflateRawSync(content);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const centralOffset = local.length + nameBytes.length + compressed.length;
  const centralSize = central.length + nameBytes.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, end]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
