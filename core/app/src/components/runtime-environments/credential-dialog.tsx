"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CredentialDialog({ onClose, onApply }: { onClose: () => void; onApply: (value: string) => void }) {
  const [value, setValue] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="runtime-credential-dialog" onCancel={onClose} aria-labelledby="runtime-credential-title">
    <form onSubmit={(event) => { event.preventDefault(); onApply(value); }}>
      <h2 id="runtime-credential-title">设置 API Key / 授权 Token</h2>
      <p>确认后加入当前草稿，点击“保存运行环境”后生效。</p>
      <label>API Key / 授权 Token<Input autoFocus type="password" autoComplete="new-password" value={value} onChange={(event) => setValue(event.target.value)} required /></label>
      <div className="runtime-actions"><Button type="button" variant="outline" size="sm" onClick={onClose}>取消</Button><Button type="submit" size="sm" disabled={!value.trim()}>确认</Button></div>
    </form>
  </dialog>;
}
