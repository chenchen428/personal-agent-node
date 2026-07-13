import { normalizeAgentCommandAliases } from './agent-aliases.mjs';
import { workspaceNameFromConfig } from './workspace-name.mjs';

export function normalizeWorkspaceEntries(config) {
  const entries = Array.isArray(config.workspaces) ? config.workspaces : [];
  const currentName = workspaceNameFromConfig(config);
  const currentRoot = config.workspace;
  const base = currentRoot ? [{
    name: currentName,
    workspaceRoot: currentRoot,
    routingTags: [currentName, 'agent-bridge-cli'].filter(Boolean),
    contextSummary: 'Agent Bridge CLI registered on the local runner.',
    agentCommandAliases: normalizeAgentCommandAliases(config),
  }] : [];
  const byKey = new Map();
  for (const entry of [...entries, ...base]) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name || entry.workspaceName || '').trim();
    const workspaceRoot = String(entry.workspaceRoot || entry.root || '').trim();
    const key = name || workspaceRoot;
    if (!key) continue;
    byKey.set(key, {
      name: name || key,
      workspaceRoot,
      routingTags: Array.isArray(entry.routingTags) ? entry.routingTags.filter((tag) => typeof tag === 'string' && tag.trim()) : [name || key, 'agent-bridge-cli'],
      contextSummary: typeof entry.contextSummary === 'string' && entry.contextSummary.trim()
        ? entry.contextSummary.trim()
        : 'Agent Bridge CLI registered on the local runner.',
      agentCommandAliases: Array.isArray(entry.agentCommandAliases) ? entry.agentCommandAliases : normalizeAgentCommandAliases(config),
    });
  }
  return Array.from(byKey.values());
}
