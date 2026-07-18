"use client";

import { useEffect, useState, type FormEvent } from "react";
import { validateLocalPasswordInput } from "@/lib/setup-tasks";
import { Button } from "../desktop-v72/primitives";
import { errorMessage } from "./shared";

export function PasswordSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const issue = validateLocalPasswordInput(password, confirmation);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (issue) { setFeedback(issue.replace("本机登录密码", "访问密码")); return; }
    setSaving(true);
    try {
      const post = async (phase: string, body: object) => {
        const response = await fetch(`/api/system/setup/actions/installation.local-auth/${phase}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (!response.ok || !payload.operation) throw new Error(payload.error?.message || "更新失败");
        return payload.operation;
      };
      const plan = await post("plan", {});
      await post("approve", { operationId: plan.id, digest: plan.digest, approved: true });
      await post("execute", { operationId: plan.id, digest: plan.digest, input: { password, confirmation } });
      onSaved("访问密码已更新，其他设备会话已失效。");
    } catch (cause) { setFeedback(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <div className="settings-dialog-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}><form className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><h2 id="password-dialog-title">修改访问密码</h2><p>新密码保存后，手机与私有域名上的其他会话会立即失效。</p><label>新的访问密码<input autoFocus type="password" minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 个字符" /></label><label>确认访问密码<input type="password" minLength={12} maxLength={256} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入" /></label>{feedback ? <div className="notice" role="alert">{feedback}</div> : null}<div className="settings-dialog-actions"><Button type="button" disabled={saving} onClick={onClose}>取消</Button><Button variant="primary" disabled={saving || Boolean(issue)}>{saving ? "保存中…" : "保存"}</Button></div></form></div>;
}
