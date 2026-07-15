import path from "node:path";

export function wireGuardLifecycle(tunnelPath, platform = process.platform) {
  const configPath = path.resolve(tunnelPath);
  if (platform === "win32") {
    return {
      platform,
      executable: "C:\\Program Files\\WireGuard\\wireguard.exe",
      args: ["/installtunnelservice", configPath],
      installCommand: `"C:\\Program Files\\WireGuard\\wireguard.exe" /installtunnelservice "${configPath}"`,
      uninstallCommand: '"C:\\Program Files\\WireGuard\\wireguard.exe" /uninstalltunnelservice private-site',
      serviceId: "WireGuardTunnel$private-site",
    };
  }
  if (platform === "darwin") {
    const up = macOsPrivilegedCommand("up", configPath);
    const down = macOsPrivilegedCommand("down", configPath);
    return {
      platform,
      executable: "/usr/bin/osascript",
      args: ["-e", up],
      installCommand: `osascript -e '${up.replaceAll("'", "'\\''")}'`,
      uninstallCommand: `osascript -e '${down.replaceAll("'", "'\\''")}'`,
      prerequisite: "brew install wireguard-tools",
    };
  }
  if (platform === "linux") {
    return {
      platform,
      executable: "sudo",
      args: ["wg-quick", "up", configPath],
      installCommand: `sudo wg-quick up "${configPath}"`,
      uninstallCommand: `sudo wg-quick down "${configPath}"`,
      prerequisite: "Install wireguard-tools with the platform package manager",
    };
  }
  throw new Error(`Unsupported WireGuard platform: ${platform}`);
}

function macOsPrivilegedCommand(action, configPath) {
  const shellPath = configPath.replaceAll("'", "'\\''");
  const command = `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin wg-quick ${action} '${shellPath}'`;
  const appleScriptCommand = command.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `do shell script "${appleScriptCommand}" with administrator privileges`;
}
