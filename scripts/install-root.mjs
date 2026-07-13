import fs from 'node:fs';
import path from 'node:path';

export function canonicalInstallRoot(value) {
  const requested = path.resolve(value);
  fs.mkdirSync(requested, { recursive: true });
  return fs.realpathSync(requested);
}
