const entryBackedRuntimeTypes = new Set(['static', 'nginx', 'nginx-proxy']);

export function deriveProjectStatus({ project, pathStatus, systemdStatus, portStatus, entryStatus }) {
  const entryBacked = entryBackedRuntimeTypes.has(project.runtime?.type);

  if (entryBacked) {
    if (entryStatus.state === 'closed') return { state: 'unreachable', tone: 'bad', label: 'Unreachable' };
    if (entryStatus.state === 'partial') return { state: 'degraded', tone: 'warn', label: 'Degraded' };
    if (entryStatus.state === 'open' || entryStatus.state === 'not-checked') {
      return { state: 'ready', tone: 'good', label: 'Ready' };
    }
  }

  if (!pathStatus.ok) return { state: 'missing', tone: 'bad', label: 'Missing' };
  if (entryStatus.state === 'closed') return { state: 'unreachable', tone: 'bad', label: 'Unreachable' };
  if (entryStatus.state === 'partial') return { state: 'degraded', tone: 'warn', label: 'Degraded' };
  if (systemdStatus.state === 'active' || portStatus.state === 'open') {
    return { state: 'running', tone: 'good', label: 'Running' };
  }
  if (systemdStatus.state === 'failed') return { state: 'failed', tone: 'bad', label: 'Failed' };
  if (['inactive', 'deactivating'].includes(systemdStatus.state)) {
    return { state: 'stopped', tone: 'warn', label: 'Stopped' };
  }
  if (project.runtime?.type === 'node-cli') {
    return systemdStatus.state === 'unavailable'
      ? { state: 'unknown', tone: 'muted', label: 'Unknown' }
      : { state: systemdStatus.state, tone: 'muted', label: titleCase(systemdStatus.state) };
  }
  if (portStatus.state === 'closed') return { state: 'stopped', tone: 'warn', label: 'Stopped' };
  return { state: 'unknown', tone: 'muted', label: 'Unknown' };
}

function titleCase(value) {
  const text = String(value || 'unknown');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
