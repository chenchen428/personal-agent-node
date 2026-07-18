import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "./config.ts";
import { installationPaths } from "./space-registry.ts";
import { prepareWindowsService } from "./windows-service.ts";

export const serviceIdentity = {
  windows: "PrivateSiteNode",
  darwin: "site.personal-agent.private-site-node",
  linux: "private-site-node.service",
};

export function preparePlatformService(config, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "win32") return prepareWindowsService(config, options);
  const cliPath = options.cliPath || path.join(workspaceRoot, "core", "runtime", "bin", "private-site.mjs");
  const installation = installationPaths(config.installationDataRoot);
  const outputDir = path.join(installation.runtimeRoot, platform === "darwin" ? "macos-service" : "linux-service");
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  if (platform === "darwin") {
    const filePath = path.join(outputDir, `${serviceIdentity.darwin}.plist`);
    fs.writeFileSync(filePath, renderLaunchdService(config, { cliPath }), "utf8");
    return {
      ok: true,
      platform,
      serviceId: serviceIdentity.darwin,
      filePath,
      installPath: path.join(os.homedir(), "Library", "LaunchAgents", `${serviceIdentity.darwin}.plist`),
      installCommand: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${serviceIdentity.darwin}.plist`,
    };
  }
  if (platform === "linux") {
    const filePath = path.join(outputDir, serviceIdentity.linux);
    fs.writeFileSync(filePath, renderSystemdUserService(config, { cliPath }), "utf8");
    return {
      ok: true,
      platform,
      serviceId: serviceIdentity.linux,
      filePath,
      installPath: path.join(os.homedir(), ".config", "systemd", "user", serviceIdentity.linux),
      installCommand: "systemctl --user daemon-reload && systemctl --user enable --now private-site-node.service",
    };
  }
  throw new Error(`Unsupported private Site Node platform: ${platform}`);
}

export function renderLaunchdService(config, { cliPath, nodePath = process.execPath } = {}) {
  const installation = installationPaths(config.installationDataRoot);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${serviceIdentity.darwin}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(nodePath)}</string><string>${xml(cliPath)}</string><string>start</string></array>
  <key>WorkingDirectory</key><string>${xml(workspaceRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PRIVATE_SITE_DATA_ROOT</key><string>${xml(config.installationDataRoot)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(installation.installationRoot, "logs", "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(installation.installationRoot, "logs", "launchd.log"))}</string>
</dict>
</plist>
`;
}

export function renderSystemdUserService(config, { cliPath, nodePath = process.execPath } = {}) {
  return `[Unit]
Description=Private Site Node for ${config.domain}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemd(workspaceRoot)}
Environment=PRIVATE_SITE_DATA_ROOT=${systemd(config.installationDataRoot)}
ExecStart=${systemd(nodePath)} ${systemd(cliPath)} start
ExecStop=${systemd(nodePath)} ${systemd(cliPath)} stop
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function systemd(value) {
  return `"${String(value).replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
