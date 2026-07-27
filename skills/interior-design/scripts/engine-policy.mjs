import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectError } from './project-v2.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_POLICY_PATH = path.resolve(moduleDirectory, '../../../registry/interior-design.json');
export const INTERIOR_ENGINES = Object.freeze(['pascal-v2']);

export function loadInteriorEnginePolicy({
  env = process.env,
  policyPath = ENGINE_POLICY_PATH,
} = {}) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const allowed = Array.isArray(policy.allowedEngines) ? policy.allowedEngines : [];
  if (policy.schemaVersion !== 2
    || policy.interiorDesignEngine !== 'pascal-v2'
    || policy.creationPolicy !== 'pascal-v2-required'
    || allowed.length !== 1
    || allowed[0] !== 'pascal-v2') {
    throw projectError('INTERIOR_ENGINE_POLICY_INVALID', 'interior-design engine policy is invalid', 6);
  }
  const configured = String(env.PERSONAL_AGENT_INTERIOR_DESIGN_ENGINE || policy.interiorDesignEngine || '').trim();
  if (!allowed.includes(configured)) {
    throw projectError('INTERIOR_ENGINE_INVALID', `unsupported interior-design engine: ${configured || '<empty>'}`, 6, {
      allowedEngines: [...INTERIOR_ENGINES],
    });
  }
  return {
    schemaVersion: policy.schemaVersion,
    configuredEngine: configured,
    creationPolicy: policy.creationPolicy,
  };
}
