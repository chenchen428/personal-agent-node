"use client";
import { useRef, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { fetchJson } from "@/lib/client-json";
import type { Skill } from "../desktop-v627/types";
import { SkillDialog } from "./skill-dialog";
import { readSkillUpload, type SkillUploadFile } from "./skill-upload";

export function SkillImportDialog({ spaceName, onClose, onImported }: { spaceName: string; onClose: () => void; onImported: (skill: Skill) => Promise<void> }) {
  const single = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SkillUploadFile[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function choose(selection: FileList | null) {
    if (!selection?.length) return;
    setBusy(true); setError(""); setFiles([]);
    try { setFiles(await readSkillUpload(selection)); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取技能文件"); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      const result = await fetchJson<{ skill: Skill }>("/api/skills/user/import", { method: "POST", headers: { "content-type": "application/json", "x-personal-agent-surface": "desktop" }, body: JSON.stringify({ files }) });
      await onImported(result.skill); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "加入技能失败"); }
    finally { setBusy(false); }
  }
  return <SkillDialog title="加入我的技能" busy={busy} onClose={onClose}>
    <p>加入到「{spaceName}」。可以选择单个 SKILL.md，或包含说明、脚本和参考资料的技能文件夹。</p>
    <p>仅支持文本资源，最多100个文件、总计2MB。加入时会检查内容，不会运行导入的脚本，也不会覆盖同名技能。</p>
    <div className="skill-import-choices"><Button disabled={busy} onClick={() => single.current?.click()}>选择 SKILL.md</Button><Button disabled={busy} onClick={() => folder.current?.click()}>选择技能文件夹</Button></div>
    <input hidden type="file" accept=".md" ref={single} aria-label="选择技能说明文件" onChange={(event) => { void choose(event.target.files); event.target.value = ""; }} />
    <input hidden type="file" ref={folder} {...{ webkitdirectory: "" }} aria-label="选择技能目录" onChange={(event) => { void choose(event.target.files); event.target.value = ""; }} />
    {files.length ? <section className="skill-import-preview"><strong>已选择 {files.length} 个文件</strong><ul>{files.map(file => <li key={file.path}>{file.path}</li>)}</ul></section> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="settings-dialog-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !files.length} onClick={() => void submit()}>{busy ? "正在处理…" : "确认加入"}</Button></div>
  </SkillDialog>;
}
