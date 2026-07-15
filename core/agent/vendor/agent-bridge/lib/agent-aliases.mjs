const DEFAULT_ALIAS = {
  key: 'codex',
  label: 'Codex',
  agentType: 'codex',
  command: 'codex app-server',
  transport: 'app-server',
  enabled: true,
  isDefault: true,
  description: 'Codex app-server runner: hot resume, interactive approval, slash commands',
};

const DEFAULT_ALIASES = [
  DEFAULT_ALIAS,
];

export function normalizeAgentCommandAliases(config = {}) {
  let rawAliases = Array.isArray(config.agentCommandAliases)
    ? config.agentCommandAliases.map((alias) => ({ ...alias }))
    : [];
  if (rawAliases.length === 0) rawAliases = DEFAULT_ALIASES.map((alias) => ({ ...alias }));
  const defaultKey = normalizeAliasKey(config.agentAlias || rawAliases.find((alias) => alias?.isDefault)?.key || 'codex');

  if (config.agentCommand) {
    const overrideIndex = rawAliases.findIndex((alias) => normalizeAliasKey(alias?.key) === defaultKey);
    const override = {
      key: defaultKey,
      label: defaultKey === 'codex' ? 'Codex' : defaultKey,
      agentType: 'codex',
      command: config.agentCommand,
      enabled: true,
      isDefault: true,
    };
    if (overrideIndex >= 0) rawAliases[overrideIndex] = { ...rawAliases[overrideIndex], ...override };
    else rawAliases.unshift(override);
  }

  const aliases = new Map();
  for (const raw of rawAliases) {
    const alias = normalizeAgentCommandAlias(raw);
    if (alias) aliases.set(alias.key, alias);
  }

  const list = Array.from(aliases.values());
  if (list.length === 0) return DEFAULT_ALIASES.map((alias) => ({ ...alias }));
  let defaultAlias = list.find((alias) => alias.enabled && alias.isDefault);
  if (!defaultAlias) defaultAlias = list.find((alias) => alias.enabled) || list[0];
  return list.map((alias) => ({ ...alias, isDefault: alias.key === defaultAlias.key }));
}

export function resolveAgentCommandAlias(config = {}, preferredKey) {
  const aliases = normalizeAgentCommandAliases(config);
  const key = normalizeAliasKey(preferredKey);
  return {
    ...(
      aliases.find((alias) => alias.enabled && alias.key === key) ||
      aliases.find((alias) => alias.enabled && alias.isDefault) ||
      aliases.find((alias) => alias.enabled) ||
      aliases[0] ||
      DEFAULT_ALIAS
    ),
  };
}

export function resolveAgentCommandForCommand(config = {}, message = {}, { resume = false, cliSessionId } = {}) {
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  const alias = resolveAgentCommandAlias(config, payload.agentAlias);
  const agentType = 'codex';
  const command = typeof payload.agentCommand === 'string' && payload.agentCommand.trim()
    ? normalizeAppServerCommand(payload.agentCommand.trim(), alias.key)
    : alias.command;

  return {
    alias: {
      ...alias,
      key: alias.key,
      agentType,
      command,
      transport: 'app-server',
    },
    command,
  };
}

export function readAgentAliasesJson(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAgentCommandAlias(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = normalizeAliasKey(raw.key);
  const command = normalizeAppServerCommand(raw.command, key);
  if (!key || !command) return null;
  return {
    key,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : key,
    agentType: 'codex',
    command,
    transport: 'app-server',
    enabled: raw.enabled !== false,
    isDefault: raw.isDefault === true,
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : undefined,
  };
}

function normalizeAliasKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeAppServerCommand(value, key) {
  const command = typeof value === 'string' ? value.trim() : '';
  if (/\bcodex\s+app-server\b/.test(command)) return command;
  if (/^codex(?:-|$)/.test(String(key))) return DEFAULT_ALIAS.command;
  return '';
}
