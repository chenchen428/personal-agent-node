export type SkillUploadFile = { path: string; content: string };

export async function readSkillUpload(selection: FileList | File[]): Promise<SkillUploadFile[]> {
  const files = Array.from(selection);
  if (!files.length || files.length > 100) throw new Error("请选择一个技能，最多包含100个文本文件。");
  if (files.some(file => file.size > 512 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 2 * 1024 * 1024) throw new Error("单文件不得超过512KB，技能总大小不得超过2MB。");
  const result = await Promise.all(files.map(async (file) => {
    const relative = file.webkitRelativePath || file.name;
    const path = file.webkitRelativePath ? relative.split("/").slice(1).join("/") : relative;
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error("技能只能包含有效的 UTF-8 文本文件，不支持二进制资源。"); }
    return { path, content };
  }));
  if (!result.some(file => file.path === "SKILL.md")) throw new Error("请选择 SKILL.md，或根目录含有 SKILL.md 的技能文件夹。");
  return result;
}
