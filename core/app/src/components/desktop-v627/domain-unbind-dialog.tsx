"use client";

import { AlertTriangle, Globe2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "../desktop-v72/primitives";

export function DomainUnbindDialog({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="domain-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
    <section className="domain-unbind-dialog" role="alertdialog" aria-modal="true" aria-labelledby="domain-unbind-title" aria-describedby="domain-unbind-description" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="domain-danger-icon"><AlertTriangle /></span><div><span className="eyebrow">移除平台域名</span><h2 id="domain-unbind-title">确认停止公网连接？</h2></div></header>
      <div className="domain-danger-callout" id="domain-unbind-description"><strong>公网入口会立即关闭</strong><p>当前分配的 Site 域名和平台邮箱地址都将停止对外提供连接，已有分享链接也会失效。</p></div>
      <div className="domain-unbind-effects"><div><Globe2 /><span><strong>Site 公网访问停止</strong><small>验证发布和手机入口将无法打开</small></span></div><div><Mail /><span><strong>平台邮箱停止收件</strong><small>发往该地址的新邮件无法进入本机</small></span></div><div className="safe"><ShieldCheck /><span><strong>本机数据不会删除</strong><small>站点、邮件归档和本机能力都会保留</small></span></div></div>
      <footer><Button disabled={busy} onClick={onCancel}>取消</Button><Button variant="danger" disabled={busy} onClick={onConfirm}>{busy ? "正在移除…" : "确认移除绑定"}</Button></footer>
    </section>
  </div>;
}
