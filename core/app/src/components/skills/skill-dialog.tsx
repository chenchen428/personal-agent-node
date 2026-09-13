"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function SkillDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="settings-dialog skill-manager-dialog" aria-labelledby="skill-manager-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="skill-manager-title">{title}</h2>{children}
  </dialog>;
}
