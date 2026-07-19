"use client";

import { Check, ExternalLink, Mail, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { DomainVerification } from "./connection-types";
import { ConnectionOperationSop } from "./connection-operation-sop";

export function DomainBindingSop({ kind, verification, remainingSeconds, authorizationUrl, collapsed, onToggle }: { kind: "mail" | "sites"; verification: DomainVerification; remainingSeconds: number; authorizationUrl?: string; collapsed: boolean; onToggle: () => void }) {
  const [qr, setQr] = useState("");
  const siteUrl = verification.evidence?.kind === "site" ? verification.evidence.url : "";
  useEffect(() => {
    let active = true;
    if (!siteUrl) { setQr(""); return; }
    void QRCode.toDataURL(siteUrl, { width: 132, margin: 1, color: { dark: "#18231d", light: "#ffffff" } }).then((value) => { if (active) setQr(value); });
    return () => { active = false; };
  }, [siteUrl]);
  const verified = verification.phase === "verified";
  const failed = verification.phase === "failed";
  const error = failed ? <div className="domain-human-guide" role="status"><strong>当前节点未通过</strong><p>{verification.error?.message || "请重新发起绑定流程。"}</p></div> : null;
  const authorizePanel = error || <div className="domain-human-guide" role="status"><strong>需要你完成平台授权</strong><p>请确认当前 GitHub Owner 账号并点击授权；收到回调后会自动进入下一节点。</p>{authorizationUrl ? <a href={authorizationUrl} target="_blank" rel="noreferrer">打开授权页面 <ExternalLink /></a> : <small>正在准备授权页面；如果没有自动打开，入口会在这里出现。</small>}</div>;
  const assignedPanel = error || <div className="domain-human-guide" role="status"><strong>{kind === "mail" ? "正在分配平台邮箱" : "正在分配域名与安全穿透"}</strong><p>平台授权已完成，资源就绪后会自动进入验证节点。</p></div>;
  const verifyPanel = error || (kind === "mail" ? <div className="domain-provider-note"><strong>公开测试邮件</strong><span>PA 会把分配的收件地址提交给 TestEmailSender，由 JoltMx 发送固定测试邮件。继续表示你确认有权测试该地址并同意其 <a href="https://testemailsender.com/terms" target="_blank" rel="noreferrer">服务条款</a>与<a href="https://testemailsender.com/privacy" target="_blank" rel="noreferrer">隐私政策</a>。</span></div> : <div className="domain-human-guide" role="status"><strong>正在发布验证 Page</strong><p>PA 会生成带有本次标记的页面，并从最终公网地址回读核对。</p></div>);
  const waitingPanel = error || <div className="domain-human-guide" role="status"><strong>{kind === "mail" ? "等待本机收到验证邮件" : "正在请求公网链接"}</strong><p>保持本页打开，检测完成后会自动提交绑定状态。</p></div>;
  const completedPanel = verified && verification.evidence ? <div className="domain-evidence"><span className="domain-evidence-check"><Check /></span><div><strong>{kind === "mail" ? "平台邮箱已验证并绑定" : "公网 Site 已验证并绑定"}</strong><small>{verification.resource}</small></div>{kind === "sites" && qr ? <img src={qr} alt="用手机查看验证发布的二维码" /> : null}<a href={verification.evidence.url} target={kind === "sites" ? "_blank" : undefined} rel={kind === "sites" ? "noreferrer" : undefined}>{verification.evidence.label}<ExternalLink /></a></div> : error || <div className="domain-human-guide" role="status"><strong>正在提交绑定状态</strong><p>全部验证证据通过后才会更新连接状态。</p></div>;
  return <ConnectionOperationSop icon={kind === "mail" ? <Mail /> : <QrCode />} title="绑定验证" summary={verified ? "全部节点已通过，绑定状态已经写入" : failed ? verification.error?.message : `完成全部节点后才会更新为绑定成功${remainingSeconds ? ` · 剩余 ${formatDuration(remainingSeconds)}` : ""}`} tone={verified ? "success" : failed ? "danger" : "working"} statusLabel={verified ? "验证通过" : failed ? "验证失败" : "验证中"} steps={verification.steps} collapsed={collapsed} onToggle={onToggle} stepPanels={{ "0": authorizePanel, "1": assignedPanel, "2": verifyPanel, "3": waitingPanel, "4": completedPanel }} />;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
