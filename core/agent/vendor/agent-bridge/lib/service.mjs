import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const CONFIG_DIR = join(homedir(), '.agent-bridge', 'harness-env', 'configs');
const LOG_DIR = join(homedir(), '.agent-bridge', 'harness-env', 'logs');
const CONFIG_FILE = join(CONFIG_DIR, 'agent-bridge.json');
const LAUNCHD_LABEL = 'com.onetouch.agent-bridge';
const SYSTEMD_SERVICE = 'agent-bridge.service';

export function installService(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const configPath = config.configFile || CONFIG_FILE;
  writeFileSync(configPath, JSON.stringify(redactRuntimeOnly(config), null, 2), { mode: 0o600 });
  chmodSync(configPath, 0o600);

  const service = platform() === 'darwin'
    ? writeLaunchdService(config, configPath)
    : writeSystemdService(config, configPath);
  console.log(`[agent-bridge] boot service written: ${service.path}`);
  console.log(`[agent-bridge] config: ${configPath}`);

  if (config.load) service.load();
  return service;
}

function writeLaunchdService(config, configPath) {
  const launchAgents = join(homedir(), 'Library', 'LaunchAgents');
  mkdirSync(launchAgents, { recursive: true });
  const plistPath = join(launchAgents, `${LAUNCHD_LABEL}.plist`);
  const stdout = join(LOG_DIR, 'launchd.out.log');
  const stderr = join(LOG_DIR, 'launchd.err.log');
  const workingDirectory = serviceWorkingDirectory();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(config.binPath)}</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--config</string>
    <string>${escapeXml(configPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(workingDirectory)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(stdout)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(stderr)}</string>
</dict>
</plist>
`;
  writeFileSync(plistPath, plist);
  return {
    path: plistPath,
    load: () => {
      spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
      const result = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('launchctl bootstrap failed');
    },
  };
}

function writeSystemdService(config, configPath) {
  const systemdDir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(systemdDir, { recursive: true });
  const servicePath = join(systemdDir, SYSTEMD_SERVICE);
  const workingDirectory = serviceWorkingDirectory();
  const unit = `[Unit]
Description=Agent Bridge CLI
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${process.execPath} ${config.binPath} start --foreground --config ${configPath}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
  writeFileSync(servicePath, unit);
  return {
    path: servicePath,
    load: () => {
      spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
      const result = spawnSync('systemctl', ['--user', 'enable', '--now', servicePath], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('systemctl enable --now failed');
    },
  };
}

function redactRuntimeOnly(config) {
  return {
    baseUrl: config.baseUrl,
    serviceUrl: config.baseUrl,
    agentCommand: config.agentCommand,
    agentAlias: config.agentAlias,
    agentCommandAliases: config.agentCommandAliases,
    appServerSandbox: config.appServerSandbox,
    appServerApprovalPolicy: config.appServerApprovalPolicy,
    appServerModel: config.appServerModel,
    appServerTransport: config.appServerTransport,
    appServerSocketPath: config.appServerSocketPath,
    workspace: config.workspace,
    workspaceProvided: config.workspaceProvided,
    workspaceName: config.workspaceName,
    workspaces: config.workspaces,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    codexSessionSync: config.codexSessionSync,
    codexSessionsDir: config.codexSessionsDir,
    codexSessionScanIntervalMs: config.codexSessionScanIntervalMs,
    codexSessionMaxAgeMs: config.codexSessionMaxAgeMs,
    codexSessionMaxFiles: config.codexSessionMaxFiles,
    codexSessionMaxMessages: config.codexSessionMaxMessages,
  };
}

function serviceWorkingDirectory() {
  return homedir();
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
}
