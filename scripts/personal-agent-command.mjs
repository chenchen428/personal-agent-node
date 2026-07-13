import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function installPersonalAgentCommand({ installRoot, platform = process.platform, env = process.env, homeDir = os.homedir(), fileSystem = fs } = {}) {
  const root = path.resolve(installRoot || env.PRIVATE_SITE_INSTALL_ROOT || path.join(homeDir, '.private-site-node'));
  const entrypoint = path.join(root, 'current', 'projects', 'core', 'node', 'bin', 'personal-agent.mjs');
  const binDir = path.resolve(env.PRIVATE_SITE_CLI_BIN || (platform === 'win32' ? (env.APPDATA || path.join(homeDir, 'AppData', 'Roaming', 'npm')) : path.join(homeDir, '.local', 'bin')));
  fileSystem.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const commandPath = path.join(binDir, platform === 'win32' ? 'personal-agent.cmd' : 'personal-agent');
  const content = platform === 'win32'
    ? `@echo off\r\nnode "${entrypoint.replaceAll('/', '\\')}" %*\r\n`
    : `#!/bin/sh\nexec node '${entrypoint.replaceAll("'", `'"'"'`)}' "$@"\n`;
  fileSystem.writeFileSync(commandPath, content, { encoding: 'utf8', mode: platform === 'win32' ? 0o600 : 0o700 });
  if (platform !== 'win32') fileSystem.chmodSync(commandPath, 0o700);
  return { commandPath, binDir, entrypoint, followsCurrent: true };
}
