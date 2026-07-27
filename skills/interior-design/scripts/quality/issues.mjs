import { canonicalJson, sha256 } from '../project-v2.mjs';

export function issue(project, ruleId, severity, message, {
  nodeIds = [],
  levelIds = [],
  requirementIds = [],
  evidenceIds = [],
  measurement = null,
  threshold = null,
  thresholdSource = 'product-concept-default',
  fix = 'Review and revise the affected design elements.',
  professionalVerification = false,
} = {}) {
  const affectedNodeIds = severity === 'blocking' && nodeIds.length === 0 ? [project.projectId] : nodeIds;
  const measured = severity === 'blocking' && measurement === null ? { evaluated: true } : measurement;
  const identity = canonicalJson({ ruleId, nodeIds: [...affectedNodeIds].sort(), levelIds: [...levelIds].sort(), requirementIds: [...requirementIds].sort(), message });
  return {
    issueId: `issue_${sha256(identity).slice(0, 16)}`,
    ruleId,
    ruleVersion: 1,
    severity,
    message,
    nodeIds: [...affectedNodeIds].sort(),
    levelIds: [...levelIds].sort(),
    requirementIds: [...requirementIds].sort(),
    evidenceIds: [...evidenceIds].sort(),
    measurement: measured,
    threshold,
    thresholdSource,
    fix,
    source: 'automatic',
    professionalVerification,
    firstSeenRevision: project.revision,
    lastVerifiedRevision: project.revision,
  };
}
