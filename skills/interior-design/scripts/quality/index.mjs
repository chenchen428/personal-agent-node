import { canonicalJson, selectedConcept, sha256, validateProjectV2 } from '../project-v2.mjs';
import { compiledSceneHash } from '../scene-hash.mjs';
import { auditEvidenceAndRequirements } from './evidence.mjs';
import { issue } from './issues.mjs';
import { auditProfessional } from './professional.mjs';
import { auditSpatial } from './spatial.mjs';

export function auditProfessionalProject(project, scenePayload = null) {
  const schemaErrors = validateProjectV2(project, { context: { spaceId: project.spaceId, ownerId: project.ownerId } });
  const findings = schemaErrors.map((message) => issue(project, 'schema.project-invalid', 'blocking', message, {
    fix: 'Repair the project data so it satisfies the v2 schema before compiling or publishing.',
  }));
  const concept = selectedConcept(project);
  if (concept) {
    findings.push(...auditEvidenceAndRequirements(project));
    findings.push(...auditSpatial(project, concept));
    findings.push(...auditProfessional(project, concept));
  }
  if (!scenePayload) {
    findings.push(issue(project, 'scene.missing', 'blocking', 'No compiled Pascal scene is available.', {
      fix: 'Compile the selected concept into a validated Pascal scene.',
    }));
  } else {
    if (scenePayload.engine !== 'pascal-v2') findings.push(issue(project, 'scene.engine-invalid', 'blocking', 'The compiled scene is not a Pascal v2 scene.', {
      fix: 'Recompile the project through the governed Pascal adapter.',
    }));
    if (scenePayload.projectId !== project.projectId) findings.push(issue(project, 'scene.project-mismatch', 'blocking', 'The compiled scene belongs to another project.', {
      fix: 'Discard the mismatched scene and compile this project again.',
    }));
    if (scenePayload.sceneHash !== compiledSceneHash(scenePayload.scene, scenePayload.furniture || [])) findings.push(issue(project, 'scene.hash-mismatch', 'blocking', 'The compiled scene hash does not match its content.', {
      fix: 'Restore the last valid manifest or recompile the scene.',
    }));
    const sceneNodeCount = Object.keys(scenePayload.scene?.nodes || {}).length + (scenePayload.furniture?.length || 0);
    if (sceneNodeCount > 500) findings.push(issue(project, 'scene.capacity-exceeded', 'blocking', 'The compiled design exceeds the supported v2 scene capacity.', {
      measurement: { sceneNodeCount },
      threshold: { maximumSceneNodes: 500 },
      thresholdSource: 'product-concept-default',
      fix: 'Reduce duplicated or decorative nodes, or split the concept into bounded design zones.',
    }));
  }
  findings.sort((a, b) => `${severityOrder(a.severity)}:${a.ruleId}:${a.issueId}`.localeCompare(`${severityOrder(b.severity)}:${b.ruleId}:${b.issueId}`));
  const blockingCount = findings.filter((entry) => entry.severity === 'blocking').length;
  const warningCount = findings.filter((entry) => entry.severity === 'warning').length;
  const report = {
    schemaVersion: 1,
    projectId: project.projectId,
    revision: project.revision,
    ruleSet: 'professional-interior-v2',
    ruleSetVersion: 1,
    ok: blockingCount === 0,
    blockingCount,
    warningCount,
    infoCount: findings.filter((entry) => entry.severity === 'info').length,
    findings,
  };
  return { ...report, sha256: sha256(canonicalJson(report)) };
}

function severityOrder(value) {
  return ({ blocking: 0, warning: 1, info: 2 })[value] ?? 9;
}
