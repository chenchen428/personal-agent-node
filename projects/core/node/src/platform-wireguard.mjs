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
    return {
      platform,
      executable: "sudo",
      args: ["wg-quick", "up", configPath],
      installCommand: `sudo wg-quick up "${configPath}"`,
      uninstallCommand: `sudo wg-quick down "${configPath}"`,
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
