import { basename, resolve } from 'node:path';

export const DEFAULT_WORKSPACE_NAME = 'harness-env';

export function workspaceNameFromConfig(config = {}) {
  const explicit = typeof config.workspaceName === 'string' ? config.workspaceName.trim() : '';
  if (explicit) return explicit;

  const workspace = typeof config.workspace === 'string' && config.workspace.trim()
    ? resolve(config.workspace)
    : '';
  if (!workspace) return DEFAULT_WORKSPACE_NAME;
  return basename(workspace) || DEFAULT_WORKSPACE_NAME;
}
