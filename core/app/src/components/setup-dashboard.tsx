"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Mail, MessageCircle, RefreshCw, Wrench } from "lucide-react";

type SetupState = "ready" | "checking" | "action-required" | "blocked" | "not-selected";
type SetupCheck = { id: string; group: string; state: SetupState; summary: string; why: string; guidance: string; actionIds?: string[] };
type ManagedCloudAction = { state: "idle" | "starting" | "running" | "succeeded" | "failed"; phase: "idle" | "enrollment" | "resources" | "complete"; code?: string };
type SetupSnapshot = { readiness: Record<string, SetupState>; checks: SetupCheck[]; actions?: { managedCloud?: ManagedCloudAction } };

const CODEX_GUIDE = "https://developers.openai.com/codex/cli/";
const RELEASES = "https://github.com/chenchen428/personal-agent-node/releases";
const canonicalAction = (id: string) => ["connectivity.choose-mode", "connectivity.repair"].includes(id) ? "connectivity.managed-authorize" : id;

const groups = [
  { key: "installation", sources: ["installation"], readiness: "console", index: "01", title: "本机安装" },
  { key: "agent", sources: ["agent"], readiness: "agent", index: "02", title: "Codex Agent" },
  { key: "connectivity", sources: ["connectivity"], readiness: "remote", index: "03", title: "公网连接" },
  { key: "mail", sources: ["mail-identity", "local-mail"], readiness: "mail", index: "04", title: "Agent 邮箱" },
];

const labels: Record<SetupState, string> = {
  ready: "可用", checking: "检查中", "action-required": "需要处理", blocked: "被前置项阻塞", "not-selected": "尚未选择",
};

const guidance: Record<SetupState, string> = {
  ready: "这组能力已经可以正常使用。",
  checking: "正在读取本机事实，请稍候。",
  "action-required": "按红色或黄色项目完成配置，然后重新检测。",
  blocked: "请先处理被标红的前置项目。",
  "not-selected": "这是可选能力，不启用也不影响本机使用。",
};

export function SetupDashboard() {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [actionId, setActionId] = useState("");
  const [actionMessage, setActionMessage] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/system/setup", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot(await response.json() as SetupSnapshot);
    } catch {
      setError("控制服务尚未就绪，请先启动 Personal Agent 后重试。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!["starting", "running"].includes(snapshot?.actions?.managedCloud?.state || "idle")) return;
    const timer = window.setTimeout(() => void refresh(), 2000);
    return () => window.clearTimeout(timer);
  }, [refresh, snapshot?.actions?.managedCloud?.state, snapshot?.actions?.managedCloud?.phase]);

  const runAction = async (requestedAction: string, input: Record<string, unknown> = {}) => {
    setActionId(requestedAction);
    setActionMessage((current) => ({ ...current, [requestedAction]: "正在准备本机操作…" }));
    const post = async (phase: "plan" | "approve" | "execute", body: Record<string, unknown>) => {
      const response = await fetch(`/api/system/setup/actions/${requestedAction}/${phase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { ok?: boolean; operation?: { id: string; digest: string }; error?: { message?: string } };
      if (!response.ok || payload.ok === false || !payload.operation) throw new Error(payload.error?.message || `操作失败（HTTP ${response.status}）`);
      return payload.operation;
    };
    try {
      const plan = await post("plan", {});
      await post("approve", { operationId: plan.id, digest: plan.digest, approved: true });
      await post("execute", { operationId: plan.id, digest: plan.digest, input });
      setActionMessage((current) => ({ ...current, [requestedAction]: requestedAction === "connectivity.managed-authorize" ? "已打开 chenjianhui.site，请在浏览器页面确认。" : "已完成，正在重新检测。" }));
      if (requestedAction === "installation.local-auth") { setPassword(""); setConfirmation(""); }
      await refresh();
    } catch (actionError) {
      setActionMessage((current) => ({ ...current, [requestedAction]: actionError instanceof Error ? actionError.message : "操作失败" }));
    } finally {
      setActionId("");
    }
  };

  const renderAction = (requestedAction: string, check: SetupCheck) => {
    if (requestedAction === "installation.local-auth") return <form className="setup-action" onSubmit={(event) => { event.preventDefault(); void runAction(requestedAction, { password, confirmation }); }}>
      <strong>设置本机登录密码</strong><small>{check.guidance}</small>
      <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="至少 12 个字符" value={password} onChange={(event) => setPassword(event.target.value)} />
      <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="再次输入密码" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      <Button type="submit" disabled={password.length < 12 || password !== confirmation || actionId === requestedAction}>{actionId === requestedAction ? "设置中" : "确认设置"}</Button>
      {actionMessage[requestedAction] ? <span>{actionMessage[requestedAction]}</span> : null}
    </form>;

    if (["installation.repair", "installation.service-repair"].includes(requestedAction)) return <div className="setup-inline-action">
      <strong><Wrench className="size-4" />用安装包自助修复</strong><span>{check.guidance}</span>
      <a className={buttonVariants({ variant: "outline" })} href={RELEASES} target="_blank" rel="noreferrer">打开安装包页面<ExternalLink className="size-3.5" /></a>
    </div>;

    if (["agent.codex.install-guide", "agent.codex.update-guide", "agent.codex.login-guide"].includes(requestedAction)) return <div className="setup-inline-action">
      <strong>按官方步骤处理 Codex</strong><span>{check.guidance}</span>
      <a className={buttonVariants({ variant: "outline" })} href={CODEX_GUIDE} target="_blank" rel="noreferrer">打开 Codex 官方指南<ExternalLink className="size-3.5" /></a>
    </div>;

    if (requestedAction === "agent.open-chat") return <div className="setup-inline-action">
      <strong><MessageCircle className="size-4" />完成一次真实对话</strong><span>{check.guidance}</span>
      <Link className={buttonVariants()} href="/app/chat">开始真实对话</Link>
    </div>;

    if (["agent.codex.retry", "connectivity.retry"].includes(requestedAction)) return <div className="setup-inline-action">
      <strong>修复后重新验证</strong><span>{check.guidance}</span>
      <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />重新检测</Button>
    </div>;

    if (["connectivity.choose-mode", "connectivity.managed-authorize", "connectivity.repair"].includes(requestedAction)) {
      const cloudAction = snapshot?.actions?.managedCloud;
      const cloudPending = ["starting", "running"].includes(cloudAction?.state || "idle");
      const cloudMessage = cloudAction?.state === "failed" ? `页面验证未完成（${cloudAction.code || "请重试"}）。`
        : cloudAction?.phase === "resources" ? "本机接入已确认，正在通过页面验证公网域名和 Agent 邮箱。"
          : cloudPending ? "已打开 chenjianhui.site，请在已登录的页面确认这台电脑。"
            : cloudAction?.state === "succeeded" ? "chenjianhui.site 页面验证已完成，正在刷新资源状态。" : "";
      return <div className="setup-inline-action">
      <strong>验证 chenjianhui.site</strong><span>{check.guidance}</span>
      <Button type="button" disabled={actionId === "connectivity.managed-authorize" || cloudPending} onClick={() => void runAction("connectivity.managed-authorize")}>{cloudPending ? "等待页面确认" : "验证公网与邮箱"}</Button>
      {cloudMessage || actionMessage["connectivity.managed-authorize"] ? <small>{cloudMessage || actionMessage["connectivity.managed-authorize"]}</small> : null}
    </div>;
    }

    if (requestedAction === "mail.enable") return <div className="setup-inline-action">
      <strong><Mail className="size-4" />按需启用邮件</strong><span>{check.guidance}</span>
      <Button variant="outline" type="button" disabled={actionId === requestedAction} onClick={() => void runAction(requestedAction)}>{actionId === requestedAction ? "启用中" : "启用邮件检测"}</Button>
      {actionMessage[requestedAction] ? <small>{actionMessage[requestedAction]}</small> : null}
    </div>;

    if (["mail.test-delivery", "mail.test-recovery"].includes(requestedAction)) return <div className="setup-inline-action">
      <strong><Mail className="size-4" />前往邮件页完成验证</strong><span>{check.guidance}</span>
      <Link className={buttonVariants({ variant: "outline" })} href="/app/mail">打开邮件页</Link>
    </div>;
    return null;
  };

  return (
    <section className="setup-grid" aria-label="Setup readiness" aria-live="polite">
      {groups.map((group) => {
        const state = loading ? "checking" : snapshot?.readiness[group.readiness] || "action-required";
        const checks = snapshot?.checks.filter((check) => group.sources.includes(check.group)) || [];
        const actionChecks = checks.filter((check) => check.state === "action-required" || (check.state === "not-selected" && check.actionIds?.some((id) => ["mail.enable", "connectivity.choose-mode", "connectivity.managed-authorize"].includes(id))));
        const actions = Array.from(new Set(actionChecks.flatMap((check) => check.actionIds || []).map(canonicalAction)));
        return (
          <article className={`setup-group setup-${state}`} key={group.key}>
            <header><span>{group.index}</span><div><h2>{group.title}</h2><small className={`status-label status-${state}`}>{labels[state]}</small></div><i className={`setup-light state-${state}`} /></header>
            <ul>{checks.length ? checks.map((check) => <li className={`check-${check.state}`} key={check.id}><div className="check-copy"><span>{check.summary}</span>{["action-required", "blocked"].includes(check.state) ? <><small>{check.guidance}</small><small className="check-why">为什么：{check.why}</small></> : null}</div><em>{labels[check.state]}</em></li>) : <li className={`check-${state}`}><div className="check-copy"><span>{error || guidance[state]}</span></div><em>{labels[state]}</em></li>}</ul>
            <p className={`setup-guidance guidance-${state}`}>{guidance[state]}</p>
            <div className="setup-actions">{actions.map((requestedAction) => {
              const check = actionChecks.find((candidate) => candidate.actionIds?.some((candidateAction) => canonicalAction(candidateAction) === requestedAction));
              return check ? <div key={requestedAction}>{renderAction(requestedAction, check)}</div> : null;
            })}</div>
            <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />重新检测</Button>
          </article>
        );
      })}
    </section>
  );
}
