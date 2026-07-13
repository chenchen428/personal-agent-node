import fs from 'node:fs';
import path from 'node:path';
import { emit, readJson, relativeToRoot, root } from './common.mjs';

export function verifyCases() {
  const catalog = readJson(path.join(root, 'registry', 'skills.json'));
  const errors = [];
  const cases = [];
  for (const skill of catalog.skills.filter((entry) => entry.caseRequired)) {
    if (!skill.examples.length) {
      errors.push(`${skill.name}: caseRequired but examples is empty`);
      continue;
    }
    for (const example of skill.examples) {
      const caseFile = path.join(root, example);
      if (!fs.existsSync(caseFile)) {
        errors.push(`${skill.name}: missing ${example}`);
        continue;
      }
      let manifest;
      try {
        manifest = readJson(caseFile);
      } catch (error) {
        errors.push(`${skill.name}: invalid case JSON (${error.message})`);
        continue;
      }
      if (manifest.skill !== skill.name) errors.push(`${skill.name}: case manifest skill mismatch`);
      if (!String(manifest.prompt || '').trim()) errors.push(`${skill.name}: case prompt is required`);
      if (!Array.isArray(manifest.commands)) errors.push(`${skill.name}: case commands must be an array`);
      if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) errors.push(`${skill.name}: case artifacts are required`);
      for (const artifact of manifest.artifacts || []) {
        const artifactPath = typeof artifact === 'string' ? artifact : artifact.path;
        if (!artifactPath) {
          errors.push(`${skill.name}: case artifact path is missing`);
          continue;
        }
        const fullPath = path.resolve(path.dirname(caseFile), artifactPath);
        const caseDir = path.dirname(caseFile);
        if (!(fullPath === caseDir || fullPath.startsWith(`${caseDir}${path.sep}`))) {
          errors.push(`${skill.name}: case artifact escapes its case directory: ${artifactPath}`);
          continue;
        }
        if (!fs.existsSync(fullPath)) errors.push(`${skill.name}: missing case artifact ${artifactPath}`);
      }
      cases.push({ skill: skill.name, manifest: relativeToRoot(caseFile), artifacts: manifest.artifacts?.length || 0 });
    }
  }
  return { cases, errors };
}

export function runCases(action, argv) {
  if (action !== 'verify') throw new Error('Usage: skill-tree cases verify');
  const result = verifyCases();
  if (result.errors.length) throw new Error(`Skill case verification failed:\n- ${result.errors.join('\n- ')}`);
  emit({ verified: result.cases.length, cases: result.cases }, argv.options);
}
