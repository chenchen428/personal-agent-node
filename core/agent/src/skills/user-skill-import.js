import path from "node:path";
import { scanSupplyChainText } from "../../../../scripts/skill-tree/security.mjs";
import { parseSkillFrontmatter } from "./catalog.js";
import { skillError, skillNamePattern } from "./user-skill-tree.js";

export const USER_SKILL_IMPORT_BYTES = 2 * 1024 * 1024;
const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".ps1", ".css", ".html", ".svg"]);
const forbiddenSegments = /^(?:\.|\.\.|\..*|secrets?|credentials?|node_modules|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateSkillImport(input) {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => key !== "files") || !Array.isArray(input.files) || !input.files.length || input.files.length > 100) throw skillError("请选择一个 SKILL.md 或包含它的技能目录，最多100个文本文件");
  const files = [], seen = new Set();
  let total = 0;
  for (const file of input.files) {
    if (!file || typeof file !== "object" || Object.keys(file).some(key => !["path", "content"].includes(key)) || typeof file.path !== "string" || typeof file.content !== "string") throw skillError("文件数据格式不正确，不支持链接或特殊文件");
    const segments = file.path.split("/");
    if (!file.path || file.path.length > 240 || /[\\:<>"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(file.path) || segments.some(segment => !segment || forbiddenSegments.test(segment) || /[. ]$/.test(segment))) throw skillError("文件路径包含不允许的目录或字符");
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw skillError("技能中存在同名文件");
    seen.add(key);
    if (!allowedExtensions.has(path.posix.extname(key))) throw skillError("仅支持技能说明、脚本和配置等文本资源，不支持二进制文件");
    const bytes = Buffer.byteLength(file.content, "utf8"); total += bytes;
    if (bytes > 512 * 1024 || total > USER_SKILL_IMPORT_BYTES) throw skillError("单文件不得超过512KB，技能总大小不得超过2MB", 413);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(file.content)) throw skillError("文件不是有效的 UTF-8 文本");
    const scan = scanSupplyChainText(file.content, { executable: true });
    if (Object.values(scan).some(Boolean) || /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{24,}/i.test(file.content)) throw skillError("技能含有可疑指令、凭据访问或上传内容，未加入");
    files.push({ path: file.path, content: file.content });
  }
  const manifest = files.find(file => file.path === "SKILL.md");
  if (!manifest) throw skillError("技能目录根部必须包含 SKILL.md");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(manifest.content);
  const keys = header?.[1].split(/\r?\n/).filter(line => line && !/^\s/.test(line)).map(line => /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line)?.[1]);
  if (!header || !header[2].trim() || !keys || keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes("name") || !keys.includes("description")) throw skillError("SKILL.md 必须包含有效的 name、description 说明头部和技能正文");
  const fields = parseSkillFrontmatter(manifest.content);
  if (typeof fields.name !== "string" || !skillNamePattern.test(fields.name) || fields.name.length > 64) throw skillError("SKILL.md 的 name 必须是64字符以内的小写英文、数字和连字符");
  if (typeof fields.description !== "string" || !fields.description.trim() || fields.description.length > 2000) throw skillError("SKILL.md 必须提供2000字符以内的 description");
  if (Object.keys(fields).some(key => !["name", "description"].includes(key))) throw skillError("技能说明头部仅支持 name 和 description");
  for (const file of files) {
    if (files.some(other => other !== file && other.path.toLowerCase().startsWith(file.path.toLowerCase() + "/"))) throw skillError("文件与目录名称冲突");
  }
  return { name: fields.name, description: fields.description.trim(), files };
}
