import path from "node:path";
import { fileURLToPath } from "node:url";

const SETUP_ENTRYPOINT_NAMES = new Set(["setup.ts", "setup.js", "setup.mjs", "setup.cjs"]);

export function isDirectWechatSetup({ metaMain = false, metaUrl = "" } = {}) {
  if (metaMain !== true || !metaUrl) return false;
  try {
    return SETUP_ENTRYPOINT_NAMES.has(path.basename(fileURLToPath(metaUrl)));
  } catch {
    return false;
  }
}
