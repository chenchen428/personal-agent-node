import fs from "node:fs";
import path from "node:path";
import { getSpace } from "../../../runtime/src/space-registry.ts";
import { runtimeError } from "./validation.ts";

export function runtimeSettingsScope(workspaceRoot: string, requestedSpaceId: string) {
  const root = path.resolve(workspaceRoot);
  let identity;
  try { identity = JSON.parse(fs.readFileSync(path.join(root, "space.json"), "utf8")); }
  catch (error) {
    if (error?.code !== "ENOENT") throw runtimeError("运行设置的空间身份不可读取。", "RUNTIME_SPACE_MISMATCH", 403);
    const installationRoot = path.dirname(path.dirname(root));
    if (path.basename(path.dirname(root)) === "spaces" && fs.existsSync(path.join(installationRoot, "installation", "spaces.sqlite"))) {
      throw runtimeError("注册空间缺少身份记录，不能退回独立运行配置。", "RUNTIME_SPACE_MISMATCH", 403);
    }
    // Standalone legacy installations and isolated library fixtures have no
    // installation registry; their existing local store remains authoritative.
    return { root, sourceSpace: { id: requestedSpaceId, kind: "personal" as const, displayName: "主空间" }, inherited: false };
  }
  if (identity.spaceId !== requestedSpaceId) throw runtimeError("运行设置请求与当前空间身份不匹配。", "RUNTIME_SPACE_MISMATCH", 403);
  const installationRoot = path.dirname(path.dirname(root));
  const current = getSpace(installationRoot, requestedSpaceId);
  if (!current || path.resolve(current.root) !== root) throw runtimeError("当前空间不属于此安装。", "RUNTIME_SPACE_MISMATCH", 403);
  const owner = current.kind === "personal" ? current : getSpace(installationRoot);
  if (!owner || owner.kind !== "personal") throw runtimeError("找不到主空间运行设置。", "RUNTIME_SOURCE_UNAVAILABLE", 503);
  return { root: owner.root, sourceSpace: { id: owner.id, kind: "personal" as const, displayName: owner.displayName }, inherited: owner.id !== current.id };
}
