import fs from "node:fs";

export function pruneInactiveRelease(releasePath, { platform = process.platform, remove = defaultRemove } = {}) {
  try {
    remove(releasePath);
    return { removed: true, deferred: false };
  } catch (error) {
    if (platform === "win32" && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
      return { removed: false, deferred: true, code: error.code };
    }
    throw error;
  }
}

function defaultRemove(releasePath) {
  fs.rmSync(releasePath, { recursive: true, force: true });
}
