import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function installPersonalAgentCommand({ installRoot, platform = process.platform, env = process.env, homeDir = os.homedir(), fileSystem = fs } = {}) {
  const targetPath = platform === 'win32' ? path.win32 : path.posix;
  const root = targetPath.resolve(installRoot || env.PRIVATE_SITE_INSTALL_ROOT || targetPath.join(homeDir, '.private-site-node'));
  const entrypoint = targetPath.join(root, 'current', 'projects', 'core', 'node', 'bin', 'personal-agent.mjs');
  const binDir = targetPath.resolve(env.PRIVATE_SITE_CLI_BIN || (platform === 'win32' ? (env.APPDATA || targetPath.join(homeDir, 'AppData', 'Roaming', 'npm')) : targetPath.join(homeDir, '.local', 'bin')));
  fileSystem.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const commandPath = targetPath.join(binDir, platform === 'win32' ? 'personal-agent.cmd' : 'personal-agent');
  const content = platform === 'win32'
    ? `@echo off\r\nset "PRIVATE_SITE_INSTALL_ROOT=${root.replaceAll('%', '%%')}"\r\nnode "${entrypoint.replaceAll('/', '\\')}" %*\r\n`
    : `#!/bin/sh\nPRIVATE_SITE_INSTALL_ROOT='${root.replaceAll("'", `'"'"'`)}' exec node '${entrypoint.replaceAll("'", `'"'"'`)}' "$@"\n`;
  fileSystem.writeFileSync(commandPath, content, { encoding: 'utf8', mode: platform === 'win32' ? 0o600 : 0o700 });
  if (platform !== 'win32') fileSystem.chmodSync(commandPath, 0o700);
  return { commandPath, binDir, entrypoint, followsCurrent: true };
}
