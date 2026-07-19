"use client";

import { AlertTriangle, Globe2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "../desktop-v72/primitives";

export function DomainUnbindDialog({ binding = "platform", busy, onCancel, onConfirm }: { binding?: "platform" | "custom"; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="domain-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
    <section className="domain-unbind-dialog" role="alertdialog" aria-modal="true" aria-labelledby="domain-unbind-title" aria-describedby="domain-unbind-description" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="domain-danger-icon"><AlertTriangle /></span><div><span className="eyebrow">清空{binding === "custom" ? "自定义" : "平台"}域名配置</span><h2 id="domain-unbind-title">确认恢复到未配置状态？</h2></div></header>
      <div className="domain-danger-callout" id="domain-unbind-description"><strong>公网入口会立即关闭</strong><p>{binding === "custom" ? "本次自定义域名连接会从这台电脑移除；DNS 记录由你在域名服务商处决定是否保留。" : "当前分配的 Site 域名和平台邮箱地址都将停止对外提供连接，已有分享链接也会失效。"}</p></div>
      <div className="domain-unbind-effects"><div><Globe2 /><span><strong>Site 公网访问停止</strong><small>验证发布和手机入口将无法打开</small></span></div><div><Mail /><span><strong>{binding === "custom" ? "自定义邮箱" : "平台邮箱"}停止收件</strong><small>发往该地址的新邮件无法进入本机</small></span></div><div className="safe"><ShieldCheck /><span><strong>本机数据不会删除</strong><small>站点、邮件归档和本机能力都会保留</small></span></div></div>
      <footer><Button disabled={busy} onClick={onCancel}>取消</Button><Button variant="danger" disabled={busy} onClick={onConfirm}>{busy ? "正在清空…" : "确认清空配置"}</Button></footer>
    </section>
  </div>;
}
