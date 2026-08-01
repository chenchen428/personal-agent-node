import { advanceDemandWorkflow, DEMAND_WORKFLOW_PROJECT_STATUS } from './demand-workflow-v1.mjs';
import {
  projectError,
  readProject,
  resolveProjectDirectory,
  writeProjectRevision,
} from './project-v2.mjs';

export function advanceProjectDemandWorkflow(projectDirInput, context, event, {
  baseRevision,
  now = () => new Date().toISOString(),
  allowLegacyRepresentative = false,
} = {}) {
  const resolved = resolveProjectDirectory(projectDirInput, context);
  const { projectDir, project } = readProject(resolved.projectDir, context);
  if (project.demandWorkflow?.version === 1 && !allowLegacyRepresentative) {
    throw projectError(
      'LEGACY_WORKFLOW_RETIRED',
      'project demandWorkflow v1 is a read-only representative snapshot; use scripts/specialist-workflow.mjs with agents/interior-designer/workflow.json',
      6,
    );
  }
  if (!Number.isInteger(baseRevision)) {
    throw projectError('WORKFLOW_REVISION_REQUIRED', 'base revision is required', 2);
  }
  if (project.revision !== baseRevision) {
    throw projectError('REVISION_CONFLICT', `base revision ${baseRevision} does not match current revision ${project.revision}`, 6, {
      currentRevision: project.revision,
      requestedBaseRevision: baseRevision,
    });
  }
  const demandWorkflow = advanceDemandWorkflow(project.demandWorkflow, event, {
    currentRevision: project.revision,
    requirementIds: new Set(project.brief.requirements.map((entry) => entry.requirementId)),
    evidenceIds: new Set(project.evidence.map((entry) => entry.evidenceId)),
    now,
  });
  const next = writeProjectRevision(projectDir, project, {
    ...structuredClone(project),
    baseRevision,
    status: DEMAND_WORKFLOW_PROJECT_STATUS[demandWorkflow.stage],
    demandWorkflow,
  }, { now });
  return {
    projectDir,
    project: next,
    transition: demandWorkflow.transitions.at(-1),
  };
}
