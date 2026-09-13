"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateLocalPasswordInput } from "@/lib/setup-tasks";
import { errorMessage } from "./shared";

export function PasswordSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [attempted, setAttempted] = useState(false);
  const submitting = useRef(false);
  const issue = validateLocalPasswordInput(password, confirmation);
  const validation = attempted || password || confirmation ? issue : "";
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const nextPassword = String(fields.get("password") || "");
    const nextConfirmation = String(fields.get("confirmation") || "");
    setPassword(nextPassword);
    setConfirmation(nextConfirmation);
    setAttempted(true);
    if (validateLocalPasswordInput(nextPassword, nextConfirmation)) return;
    submitting.current = true;
    setFeedback("");
    setSaving(true);
    try {
      const post = async (phase: string, body: object) => {
        const response = await fetch(`/api/system/setup/actions/installation.local-auth/${phase}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        const expectedStatus = phase === "plan" ? "planned" : phase === "approve" ? "approved" : "succeeded";
        if (!response.ok || payload.ok !== true || payload.operation?.status !== expectedStatus) throw new Error(payload.error?.message || "更新失败，请重试。");
        return payload.operation;
      };
      const plan = await post("plan", {});
      await post("approve", { operationId: plan.id, digest: plan.digest, approved: true });
      const executed = await post("execute", { operationId: plan.id, digest: plan.digest, input: { password: nextPassword, confirmation: nextConfirmation } });
      if (executed.result?.configured !== true) throw new Error("密码尚未保存，请重试。");
      onSaved("访问密码已更新，其他设备会话已失效。");
    } catch (cause) { setFeedback(errorMessage(cause)); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <div className="settings-dialog-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}>
    <form className="settings-dialog" method="post" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" noValidate onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <h2 id="password-dialog-title">修改访问密码</h2>
      <p>新密码保存后，公网访问的其他登录会话会立即失效。</p>
      <p id="password-requirements">密码需要 12–256 个字符，两次输入须一致。</p>
      <label>新的访问密码<Input autoFocus name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} disabled={saving} aria-describedby="password-requirements password-validation" value={password} onChange={(event) => { setPassword(event.target.value); setFeedback(""); }} placeholder="至少 12 个字符" /></label>
      <label>确认访问密码<Input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} disabled={saving} aria-describedby="password-validation" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setFeedback(""); }} placeholder="再次输入" /></label>
      <div id="password-validation" role="status" aria-live="polite">{validation}</div>
      {feedback ? <div className="notice" role="alert">{feedback}</div> : null}
      <div className="settings-dialog-actions"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button><Button type="submit" disabled={saving}>{saving ? "保存中…" : "确认修改"}</Button></div>
    </form>
  </div>;
}
