import fs from 'node:fs';
import path from 'node:path';

export function expectedSharpPackages(platform, architecture) {
  if (!['x64', 'arm64'].includes(architecture)) throw new Error(`Unsupported Sharp architecture: ${architecture}`);
  if (platform === 'win32') return [`sharp-win32-${architecture}`];
  if (platform === 'darwin' || platform === 'linux') {
    return [`sharp-${platform}-${architecture}`, `sharp-libvips-${platform}-${architecture}`];
  }
  throw new Error(`Unsupported Sharp platform: ${platform}`);
}

export function overlaySharpNativeRuntime({ workspaceRoot, releaseRoot, platform, architecture }) {
  const sourceRoot = path.join(workspaceRoot, 'node_modules', '@img');
  const targetRoot = path.join(releaseRoot, 'node_modules', '@img');
  const packages = expectedSharpPackages(platform, architecture);
  fs.mkdirSync(targetRoot, { recursive: true });

  for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('sharp-')) {
      fs.rmSync(path.join(targetRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const name of packages) {
    const source = path.join(sourceRoot, name);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`Sharp native package is missing for ${platform}-${architecture}: ${name}`);
    }
    fs.cpSync(source, path.join(targetRoot, name), { recursive: true, preserveTimestamps: true });
  }
  return { platform: `${platform}-${architecture}`, packages };
}
