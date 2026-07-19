"use client";

import { Check, Globe2, LoaderCircle, Mail, ServerCog, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { runSetupAction } from "@/lib/setup-action-client";
import { Button } from "../desktop-v72/primitives";
import type { Connection, DomainVerification } from "./connection-types";
import { DomainUnbindDialog } from "./domain-unbind-dialog";
import { errorMessage, fetchJson } from "./shared";

type Phase = "configure" | "verifying" | "complete";
const STEP_LABELS = ["启动转发服务", "配置自定义域名", "验证并生效"];

export function CustomDomainSop({ connection, refresh, onExit }: { connection: Connection; refresh: () => Promise<void>; onExit: () => void }) {
  const kind = connection.id as "mail" | "sites";
  const verified = connection.details?.bindingMode === "custom" && connection.details?.domainVerification?.phase === "verified";
  const [phase, setPhase] = useState<Phase>(verified ? "complete" : "configure");
  const [domain, setDomain] = useState(connection.details?.customDomain || "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showRemove, setShowRemove] = useState(false);
  const activeStep = phase === "configure" ? 1 : 2;

  const startAndVerify = async () => {
    const deadline = Date.now() + 3 * 60_000;
    setBusy(true);
    setFeedback("");
    setPhase("verifying");
    try {
      await runSetupAction("connectivity.custom-domain-start", { kind, domain });
      await fetchJson(`/api/connections/${kind}/domain-binding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ binding: "custom", deadlineAt: new Date(deadline).toISOString() }),
      });
      const completed = await waitForVerification(kind, deadline);
      if (completed.phase !== "verified") throw new Error(completed.error?.message || "自定义域名检测未通过");
      await refresh();
      setPhase("complete");
      setFeedback("自定义域名已通过全链路检测");
    } catch (error) {
      setPhase("configure");
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setFeedback("");
    try {
      await runSetupAction("connectivity.custom-domain-remove", { kind });
      await refresh();
      setShowRemove(false);
      onExit();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const displayDomain = connection.details?.customDomain || domain;
  return <section className={`domain-sop custom-domain-sop state-${phase === "complete" ? "complete" : "running"}`} aria-label={`${kind === "mail" ? "邮箱" : "Sites"}自定义域名配置`}>
    <header className="custom-domain-header"><span>{kind === "mail" ? <Mail /> : <Globe2 />}</span><div><strong>使用自定义域名</strong><small>只填写域名；服务与 DNS 准备完成后由 Personal Agent 检测</small></div><em>{phase === "complete" ? "已生效" : `第 ${activeStep + 1} 步，共 3 步`}</em></header>
    <ol className="custom-domain-steps">{STEP_LABELS.map((label, index) => { const complete = phase === "complete" || index < activeStep; const active = phase !== "complete" && index === activeStep; return <li className={complete ? "complete" : active ? "active" : "pending"} key={label}><span>{complete ? <Check /> : active && phase === "verifying" ? <LoaderCircle /> : index + 1}</span><strong>{label}</strong><small>{complete ? "已准备" : active ? "当前步骤" : "等待"}</small></li>; })}</ol>
    {phase === "configure" ? <>
      <div className="custom-domain-panel"><span><ServerCog /></span><div><strong>第一步：准备服务</strong><p>{kind === "mail" ? "请准备可接收并安全转发邮件的服务器；连接密钥保存在本机 Workspace。" : "请在自己的服务器启动兼容 pa-reverse-ws-v1 的转发服务，并使用本机 Workspace 中的连接密钥。"}</p><code>{kind === "mail" ? "Workspace/secrets/custom-domain/relay-token" : "Workspace/secrets/custom-domain/relay-token · WSS /v1/connect"}</code></div></div>
      <div className="custom-domain-panel"><span><Globe2 /></span><div><strong>第二步：配置域名</strong><p>{kind === "mail" ? "将域名的 MX 记录指向你准备的邮件服务；配置完成后再开始检测。" : "将主域名与通配子域名解析到转发服务器；每个 Space 自动使用独立子域名。"}</p><label>自定义域名<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" aria-label="自定义域名" /></label><code>{kind === "mail" ? `MX  ${domain || "example.com"}` : `A  ${domain || "example.com"} · A  *.${domain || "example.com"}`}</code></div><Button variant="primary" disabled={busy || !domain.trim()} onClick={() => void startAndVerify()}>配置好了，开始检测</Button></div>
    </> : null}
    {phase === "verifying" ? <div className="custom-domain-panel"><span className="loading"><LoaderCircle /></span><div><strong>正在检测全链路</strong><p>{kind === "mail" ? "正在检查 MX、邮件转发与真实测试邮件。" : "正在检查 DNS、TLS、Relay 连接和最终页面内容。"}</p></div><span>检测中</span></div> : null}
    {phase === "complete" ? <div className="custom-domain-result"><ShieldCheck /><div><strong>{kind === "mail" ? "自定义邮箱域名已生效" : "全部 Space 的自定义域名已生效"}</strong><p>{connection.details?.customPublicAddress || displayDomain}</p></div><Button onClick={() => setShowRemove(true)}>清空配置</Button></div> : null}
    {phase !== "complete" ? <button className="custom-domain-back" type="button" onClick={onExit}>返回平台域名选项</button> : null}<span className="connection-action-message" role="status">{feedback}</span>
    {showRemove ? <DomainUnbindDialog binding="custom" busy={busy} onCancel={() => setShowRemove(false)} onConfirm={() => void remove()} /> : null}
  </section>;
}

async function waitForVerification(kind: "mail" | "sites", deadline: number) {
  while (Date.now() < deadline) {
    const result = await fetchJson<{ verification: DomainVerification }>(`/api/connections/${kind}/domain-binding`);
    if (["verified", "failed"].includes(result.verification.phase)) return result.verification;
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
  }
  throw new Error("自定义域名检测已超过 3 分钟，请检查配置后重试");
}
