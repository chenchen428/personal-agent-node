export const HANDLED_COMMAND_KEYS = Object.freeze([
  'help',
  'status',
  'doctor',
  'setup status',
  'setup open',
  'capabilities list',
  'capabilities inspect',
  'skill list',
  'skill inspect',
  'skill verify',
  'connection status',
  'cloud connect',
  'cloud login',
  'cloud resources',
  'cloud status',
  'backup status',
  'mail status',
  'mail plan',
  'extension list',
  'extension inspect',
  'operation list',
  'operation show',
  'operation approve',
]);

export function commandKey(resource, action) {
  return [resource, action].filter(Boolean).join(' ');
}

export function expandCommandName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts;
  if (parts.length !== 2) throw new Error(`Invalid command group: ${name}`);
  return parts[1].split('|').map((action) => `${parts[0]} ${action}`);
}
