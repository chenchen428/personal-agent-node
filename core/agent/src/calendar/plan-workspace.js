import fs from "node:fs";
import path from "node:path";
import { calendarError } from "./validation.js";

function resolvedThroughExistingParents(value) {
  let cursor = path.resolve(value);
  const tail = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(fs.realpathSync(cursor), ...tail);
}

export function planWorkspace(value, allowedRoot) {
  const root = resolvedThroughExistingParents(allowedRoot);
  const candidate = resolvedThroughExistingParents(value || root);
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw calendarError(403, "PLAN_WORKSPACE_OUTSIDE_SPACE", "计划只能在当前空间工作区执行");
  }
  return candidate;
}
