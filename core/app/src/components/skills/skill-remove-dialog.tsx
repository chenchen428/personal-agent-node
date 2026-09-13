"use client";
import { useState } from "react";
import { fetchJson } from "@/lib/client-json";
import { Button } from "../desktop-v72/primitives";
import type { Skill } from "../desktop-v627/types";
import { SkillDialog } from "./skill-dialog";

export type RemovedSkill = { name: string; trashId: string };

export function SkillRemoveDialog({ skill, spaceName, onClose, onRemoved }: { skill: Skill; spaceName: string; onClose: () => void; onRemoved: (removed: RemovedSkill) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const target = skill.source.kind === "user" && skill.management?.removable ? skill.management : null;
  async function remove() {
    if (!target?.name || !target.digest) return;
    setBusy(true); setError("");
    try {
      const result = await fetchJson<RemovedSkill>(`/api/skills/user/${encodeURIComponent(target.name)}`, { method: "DELETE", headers: { "content-type": "application/json", "x-personal-agent-surface": "desktop" }, body: JSON.stringify({ confirmed: true, digest: target.digest }) });
      await onRemoved(result); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除技能失败"); }
    finally { setBusy(false); }
  }
  return <SkillDialog title={`移除「${skill.name}」？`} busy={busy} onClose={onClose}>
    <p>该技能将从「{spaceName}」的可用目录中移除，之后的新回合不再加载它。已开始的任务不会被中断。</p>
    <p>技能文件会保留在当前空间的技能回收目录中，移除后可撤销。</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className="settings-dialog-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" disabled={busy || !target} onClick={() => void remove()}>{busy ? "正在移除…" : "确认移除"}</Button></div>
  </SkillDialog>;
}
