"use client";

import { History, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "../desktop-v72/primitives";

export function ConnectionClearDialog({
  connectionName,
  configurationSummary,
  preservedSummary,
  releaseSummary,
  busy,
  onCancel,
  onConfirm,
}: {
  connectionName: string;
  configurationSummary: string;
  preservedSummary: string;
  releaseSummary?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = `connection-clear-${connectionName.replace(/[^a-z0-9]+/gi, "-") || "configuration"}`;
  return <div className="domain-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
    <section className="domain-unbind-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="domain-danger-icon"><Trash2 /></span><div><span className="eyebrow">清空{connectionName}配置</span><h2 id={titleId}>确认恢复到未配置状态？</h2></div></header>
      <div className="domain-danger-callout"><strong>当前连接会立即停止</strong><p>{configurationSummary}</p></div>
      <div className="domain-unbind-effects"><div><Trash2 /><span><strong>连接配置全部复位</strong><small>清空后按钮恢复为“配置”，可以重新完成连接</small></span></div><div className="safe"><History /><span><strong>本机内容继续保留</strong><small>{preservedSummary}</small></span></div>{releaseSummary ? <div className="safe"><ShieldCheck /><span><strong>释放连接独占绑定</strong><small>{releaseSummary}</small></span></div> : null}</div>
      <footer><Button disabled={busy} onClick={onCancel}>取消</Button><Button variant="danger" disabled={busy} onClick={onConfirm}>{busy ? "正在清空…" : "确认清空配置"}</Button></footer>
    </section>
  </div>;
}
