"use client";

import { Check, ExternalLink, Mail, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { DomainVerification } from "./connection-types";
import { ConnectionOperationSop } from "./connection-operation-sop";

export function DomainBindingSop({ kind, verification, remainingSeconds, collapsed, onToggle }: { kind: "mail" | "sites"; verification: DomainVerification; remainingSeconds: number; collapsed: boolean; onToggle: () => void }) {
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
  return <ConnectionOperationSop icon={kind === "mail" ? <Mail /> : <QrCode />} title="绑定验证" summary={verified ? "全部节点已通过，绑定状态已经写入" : failed ? verification.error?.message : `完成全部节点后才会更新为绑定成功${remainingSeconds ? ` · 剩余 ${formatDuration(remainingSeconds)}` : ""}`} tone={verified ? "success" : failed ? "danger" : "working"} statusLabel={verified ? "验证通过" : failed ? "验证失败" : "验证中"} steps={verification.steps} collapsed={collapsed} onToggle={onToggle}>
      {verification.phase === "authorizing" ? <div className="domain-human-guide" role="status"><strong>需要你完成平台授权</strong><p>浏览器会打开 personal-agent.cn。请确认当前 GitHub Owner 账号并点击授权，然后返回这里；收到平台授权回调后，流程会自动进入下一节点。</p></div> : null}
      {kind === "mail" && !verified ? <div className="domain-provider-note"><strong>公开测试邮件</strong><span>PA 会把分配的收件地址提交给 TestEmailSender，由 JoltMx 发送一封固定测试邮件。点击“使用平台域名”表示你确认有权测试该地址并同意其 <a href="https://testemailsender.com/terms" target="_blank" rel="noreferrer">服务条款</a>与<a href="https://testemailsender.com/privacy" target="_blank" rel="noreferrer">隐私政策</a>。</span></div> : null}
      {verified && verification.evidence ? <div className="domain-evidence"><span className="domain-evidence-check"><Check /></span><div><strong>{kind === "mail" ? "平台邮箱已验证并绑定" : "公网 Site 已验证并绑定"}</strong><small>{verification.resource}</small></div>{kind === "sites" && qr ? <img src={qr} alt="用手机查看验证发布的二维码" /> : null}<a href={verification.evidence.url} target={kind === "sites" ? "_blank" : undefined} rel={kind === "sites" ? "noreferrer" : undefined}>{verification.evidence.label}<ExternalLink /></a></div> : null}
  </ConnectionOperationSop>;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
