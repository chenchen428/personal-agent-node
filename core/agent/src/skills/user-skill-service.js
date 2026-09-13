import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceSkills, readWorkspaceSkillCatalog } from "./catalog.js";
import { validateSkillImport } from "./user-skill-import.js";
import { assertPlainDirectory, ownedSkillRoot, skillError, skillNamePattern, skillTreeDigest } from "./user-skill-tree.js";

export function createUserSkillService({ workspaceRoot, releaseRoot }) {
  function root() {
    if (!releaseRoot || path.resolve(releaseRoot) === path.resolve(workspaceRoot)) throw skillError("发行目录中的内置技能不能修改", 403);
    return ownedSkillRoot(workspaceRoot, { create: true });
  }
  function target(name) {
    if (typeof name !== "string" || !skillNamePattern.test(name) || name.length > 64) throw skillError("技能目标无效");
    return path.join(root(), name);
  }
  function privateDirectory(name) {
    const directory = path.join(root(), name);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    assertPlainDirectory(directory);
    return directory;
  }
  function availableName(name) {
    const catalog = resolveWorkspaceSkills(workspaceRoot, { releaseRoot });
    if (catalog.skills.some(skill => skill.name.toLowerCase() === name.toLowerCase()) || fs.readdirSync(root()).some(entry => entry.toLowerCase() === name.toLowerCase())) throw skillError("已存在同名技能，不能覆盖。请修改导入技能的 name 后重试", 409, "USER_SKILL_CONFLICT");
  }
  function catalogSkill(name) {
    return readWorkspaceSkillCatalog(workspaceRoot, { releaseRoot }).skills.find(skill => skill.id === `user:skills/${name}`);
  }
  function reserveAndWrite(name, write) {
    const staging = privateDirectory(".staging"), destination = target(name);
    // mkdir is an exclusive name reservation on Windows and POSIX. rename alone could replace an empty directory.
    try { fs.mkdirSync(destination); }
    catch (error) { if (error.code === "EEXIST") throw skillError("已存在同名技能，不能覆盖", 409, "USER_SKILL_CONFLICT"); throw error; }
    try { write(destination); }
    catch (error) {
      assertPlainDirectory(staging); assertPlainDirectory(destination);
      fs.renameSync(destination, path.join(staging, crypto.randomUUID()));
      throw error;
    }
  }
  function ensureParents(root, relative) {
    let current = root;
    for (const part of relative.split("/").slice(0, -1)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) fs.mkdirSync(current);
      assertPlainDirectory(current);
    }
    return path.join(root, ...relative.split("/"));
  }
  const operations = {
    import(input) {
      const validated = validateSkillImport(input);
      root(); availableName(validated.name);
      // The only input is text, and every newly created entry is a normal file. Nothing is executed.
      reserveAndWrite(validated.name, destination => {
        // The shared catalog sees the skill only after all supporting files are durable.
        for (const file of [...validated.files].sort((a, b) => Number(a.path === "SKILL.md") - Number(b.path === "SKILL.md"))) {
          const filePath = ensureParents(destination, file.path);
          fs.writeFileSync(filePath, file.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
      });
      return { skill: catalogSkill(validated.name) };
    },
    remove(name, input) {
      if (!input || Object.keys(input).some(key => !["confirmed", "digest"].includes(key)) || input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.digest || "")) throw skillError("请确认要移除的技能及当前版本");
      const directory = target(name);
      const skill = catalogSkill(name);
      if (!skill || skill.source.kind !== "user" || !skill.management?.removable) throw skillError("只能移除当前空间的普通用户技能", 403);
      if (skillTreeDigest(directory) !== input.digest) throw skillError("技能已发生变化，请刷新后重新确认", 409, "USER_SKILL_CHANGED");
      const trashId = crypto.randomUUID();
      const trash = path.join(privateDirectory(".trash"), trashId);
      fs.mkdirSync(trash);
      fs.writeFileSync(path.join(trash, "manifest.json"), JSON.stringify({ name, digest: input.digest, removedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      // Retain the complete tree for undo; do not recursively delete user files.
      root(); assertPlainDirectory(path.dirname(trash)); assertPlainDirectory(trash);
      if (skillTreeDigest(directory) !== input.digest) throw skillError("技能已发生变化，请刷新后重新确认", 409, "USER_SKILL_CHANGED");
      fs.renameSync(directory, path.join(trash, "skill"));
      return { removed: true, name, trashId };
    },
    restore(input) {
      if (!input || Object.keys(input).some(key => key !== "trashId") || !/^[a-f0-9-]{36}$/.test(input.trashId || "")) throw skillError("恢复目标无效");
      const trash = path.join(privateDirectory(".trash"), input.trashId);
      assertPlainDirectory(trash);
      const manifestFile = path.join(trash, "manifest.json");
      const stat = fs.lstatSync(manifestFile, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 2048) throw skillError("恢复记录不可用", 409);
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      target(manifest.name);
      availableName(manifest.name);
      const source = path.join(trash, "skill");
      if (skillTreeDigest(source) !== manifest.digest) throw skillError("已移除技能的内容发生变化，未恢复", 409);
      reserveAndWrite(manifest.name, destination => {
        function copy(current, prefix = "") {
          for (const name of fs.readdirSync(current).sort((a, b) => Number(!prefix && a === "SKILL.md") - Number(!prefix && b === "SKILL.md"))) {
            const from = path.join(current, name), relative = prefix + name;
            const stat = fs.lstatSync(from);
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) throw skillError("恢复目录含有链接或特殊文件", 409);
            if (stat.isDirectory()) { fs.mkdirSync(path.join(destination, relative)); copy(from, relative + "/"); }
            else fs.copyFileSync(from, ensureParents(destination, relative), fs.constants.COPYFILE_EXCL);
          }
        }
        copy(source);
        if (skillTreeDigest(destination) !== manifest.digest || skillTreeDigest(source) !== manifest.digest) throw skillError("恢复时技能内容发生变化，请重试", 409);
      });
      return { restored: true, skill: catalogSkill(manifest.name) };
    },
  };
  return Object.fromEntries(Object.entries(operations).map(([name, operation]) => [name, (...args) => {
    try { return operation(...args); }
    catch (error) {
      if (String(error?.code || "").startsWith("USER_SKILL_")) throw error;
      throw skillError("技能文件状态已变化或不可访问，请刷新后重试", 409);
    }
  }]));
}
