import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function skillError(message, statusCode = 400, code = "USER_SKILL_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

export function ownedSkillRoot(workspaceRoot, { create = false } = {}) {
  const workspace = path.resolve(workspaceRoot);
  if (!fs.lstatSync(workspace, { throwIfNoEntry: false })?.isDirectory() || fs.lstatSync(workspace).isSymbolicLink()) throw skillError("当前空间技能目录不可用", 409);
  const root = path.join(workspace, "skills");
  if (create && !fs.existsSync(root)) fs.mkdirSync(root);
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw skillError("技能目录是链接或非常规目录，不能修改", 409);
  return root;
}

export function assertPlainDirectory(directory) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw skillError("目标技能不是当前空间的普通目录", 409);
}

export function skillTreeDigest(directory) {
  assertPlainDirectory(directory);
  const hash = crypto.createHash("sha256");
  let count = 0, bytes = 0;
  function visit(current, prefix = "") {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), relative = prefix + name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) throw skillError("技能包含链接或特殊文件，请在本机检查后再管理", 409);
      if (stat.isDirectory()) { hash.update(`directory:${relative}\0`); visit(file, relative + "/"); }
      else {
        count++; bytes += stat.size;
        if (count > 1000 || bytes > 16 * 1024 * 1024) throw skillError("技能过大，无法从界面安全管理", 413);
        hash.update(`file:${relative}\0${stat.size}\0`); hash.update(fs.readFileSync(file));
      }
    }
  }
  visit(directory);
  return hash.digest("hex");
}

export function userSkillManagement(absolute, directory) {
  const name = directory.replace(/^skills\//, "");
  if (!directory.startsWith("skills/") || !skillNamePattern.test(name) || name.length > 64) return { removable: false };
  try { return { removable: true, name, digest: skillTreeDigest(absolute) }; }
  catch { return { removable: false }; }
}
