import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function installPersonalAgentCommand({ homeRoot, installRoot, dataRoot, platform = process.platform, env = process.env, homeDir = os.homedir(), fileSystem = fs } = {}) {
  const targetPath = platform === 'win32' ? path.win32 : path.posix;
  const resolvedHome = targetPath.resolve(homeRoot || env.PERSONAL_AGENT_HOME || targetPath.join(homeDir, '.personal-agent'));
  const root = targetPath.resolve(installRoot || env.PRIVATE_SITE_INSTALL_ROOT || targetPath.join(resolvedHome, 'core'));
  const runtimeDataRoot = targetPath.resolve(dataRoot || env.PRIVATE_SITE_DATA_ROOT || targetPath.join(resolvedHome, 'workspace'));
  const entrypoint = targetPath.join(root, 'current', 'core', 'runtime', 'bin', 'personal-agent.mjs');
  const binDir = targetPath.resolve(env.PRIVATE_SITE_CLI_BIN || (platform === 'win32' ? targetPath.join(env.APPDATA || targetPath.join(homeDir, 'AppData', 'Roaming'), 'npm') : targetPath.join(homeDir, '.local', 'bin')));
  fileSystem.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const commandPath = targetPath.join(binDir, platform === 'win32' ? 'personal-agent.cmd' : 'personal-agent');
  const content = platform === 'win32'
    ? `@echo off\r\nset "PERSONAL_AGENT_HOME=${resolvedHome.replaceAll('%', '%%')}"\r\nset "PRIVATE_SITE_INSTALL_ROOT=${root.replaceAll('%', '%%')}"\r\nset "PRIVATE_SITE_DATA_ROOT=${runtimeDataRoot.replaceAll('%', '%%')}"\r\nnode "${entrypoint.replaceAll('/', '\\')}" %*\r\n`
    : `#!/bin/sh\nPERSONAL_AGENT_HOME='${resolvedHome.replaceAll("'", `'"'"'`)}' PRIVATE_SITE_INSTALL_ROOT='${root.replaceAll("'", `'"'"'`)}' PRIVATE_SITE_DATA_ROOT='${runtimeDataRoot.replaceAll("'", `'"'"'`)}' exec node '${entrypoint.replaceAll("'", `'"'"'`)}' "$@"\n`;
  fileSystem.writeFileSync(commandPath, content, { encoding: 'utf8', mode: platform === 'win32' ? 0o600 : 0o700 });
  if (platform !== 'win32') fileSystem.chmodSync(commandPath, 0o700);
  return { commandPath, binDir, homeRoot: resolvedHome, entrypoint, dataRoot: runtimeDataRoot, followsCurrent: true };
}
