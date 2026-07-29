import { issue } from './issues.mjs';

export function auditEvidenceAndRequirements(project) {
  const findings = [];
  if (!project.evidence.length) {
    findings.push(issue(project, 'evidence.missing', 'blocking', 'No governed project evidence is recorded.', {
      fix: 'Register and classify the supplied floor plan, measurements, photos, or edit target.',
    }));
  }
  const hasCalibration = project.evidence.some((entry) => entry.calibration?.basis === 'known-length' || entry.classification === 'measurement');
  if (!hasCalibration) {
    findings.push(issue(project, 'evidence.scale-concept-only', 'warning', 'No reliable calibration is available; the result remains a concept model.', {
      evidenceIds: project.evidence.map((entry) => entry.evidenceId),
      fix: 'Provide one verified length before relying on dimensions or quantities.',
      professionalVerification: true,
    }));
  }
  const calibrationGroups = Map.groupBy(
    project.evidence.filter((entry) => entry.confidence === 'verified'
      && Number.isFinite(entry.calibration?.knownLengthMetres)
      && (entry.calibration.segmentId || entry.calibration.referenceId)),
    (entry) => entry.calibration.segmentId || entry.calibration.referenceId,
  );
  for (const [segmentId, records] of calibrationGroups) {
    const verifiedLengths = records.map((entry) => entry.calibration.knownLengthMetres);
    if (verifiedLengths.length > 1) {
      const min = Math.min(...verifiedLengths);
      const max = Math.max(...verifiedLengths);
      if (!(min > 0 && max / min > 1.05)) continue;
      findings.push(issue(project, 'evidence.calibration-conflict', 'blocking', 'Verified calibration records disagree by more than five percent.', {
        evidenceIds: records.map((entry) => entry.evidenceId),
        measurement: { segmentId, minMetres: min, maxMetres: max, ratio: max / min },
        threshold: { maximumRatio: 1.05 },
        thresholdSource: 'product-concept-default',
        fix: 'Resolve which measured segment each calibration refers to and recalibrate the model.',
      }));
    }
  }
  for (const requirement of project.brief.requirements) {
    if (requirement.priority === 'must' && !['satisfied', 'blocked'].includes(requirement.status)) {
      findings.push(issue(project, 'requirements.must-unresolved', 'blocking', `Must requirement is not resolved: ${requirement.summary || requirement.requirementId}.`, {
        requirementIds: [requirement.requirementId],
        nodeIds: requirement.sceneNodeIds || [],
        fix: 'Satisfy the requirement or explicitly mark it blocked with a visible rationale.',
      }));
    }
    if (requirement.priority === 'must' && requirement.status === 'blocked') {
      findings.push(issue(project, 'requirements.must-blocked-visible', 'warning', `Must requirement remains explicitly blocked: ${requirement.summary || requirement.requirementId}.`, {
        requirementIds: [requirement.requirementId],
        nodeIds: requirement.sceneNodeIds || [],
        fix: 'Keep this limitation visible in the delivery and obtain a user or professional decision.',
      }));
    }
    if (requirement.priority === 'must'
      && requirement.status === 'satisfied'
      && !(requirement.sceneNodeIds || []).length
      && !requirement.verification?.result) {
      findings.push(issue(project, 'requirements.must-untraced', 'blocking', `Must requirement has no model node or verification result: ${requirement.summary || requirement.requirementId}.`, {
        requirementIds: [requirement.requirementId],
        measurement: { linkedSceneNodes: 0, hasVerificationResult: false },
        threshold: { minimumLinkedSceneNodesOrVerification: 1 },
        thresholdSource: 'product-concept-default',
        fix: 'Link the requirement to affected scene nodes or record a reproducible verification result.',
      }));
    }
  }
  return findings;
}
