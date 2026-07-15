"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";

type SetupState = "ready" | "checking" | "action-required" | "blocked" | "not-selected";
type SetupCheck = { id: string; group: string; state: SetupState; summary: string; actionIds?: string[] };
type SetupSnapshot = { readiness: Record<string, SetupState>; checks: SetupCheck[] };

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
      setActionMessage((current) => ({ ...current, [requestedAction]: "已完成，正在重新检测。" }));
      if (requestedAction === "installation.local-auth") { setPassword(""); setConfirmation(""); }
      await refresh();
    } catch (actionError) {
      setActionMessage((current) => ({ ...current, [requestedAction]: actionError instanceof Error ? actionError.message : "操作失败" }));
    } finally {
      setActionId("");
    }
  };

  return (
    <section className="setup-grid" aria-label="Setup readiness" aria-live="polite">
      {groups.map((group) => {
        const state = loading ? "checking" : snapshot?.readiness[group.readiness] || "action-required";
        const checks = snapshot?.checks.filter((check) => group.sources.includes(check.group)) || [];
        const localAuthRequired = checks.some((check) => check.actionIds?.includes("installation.local-auth") && check.state !== "ready");
        const conversationRequired = checks.some((check) => check.actionIds?.includes("agent.open-chat") && check.state !== "ready");
        const mailNotSelected = checks.some((check) => check.actionIds?.includes("mail.enable") && check.state === "not-selected");
        return (
          <article className={`setup-group setup-${state}`} key={group.key}>
            <header><span>{group.index}</span><div><h2>{group.title}</h2><small className={`status-label status-${state}`}>{labels[state]}</small></div><i className={`setup-light state-${state}`} /></header>
            <ul>{checks.length ? checks.map((check) => <li className={`check-${check.state}`} key={check.id}><span>{check.summary}</span><em>{labels[check.state]}</em></li>) : <li className={`check-${state}`}><span>{error || guidance[state]}</span><em>{labels[state]}</em></li>}</ul>
            <p className={`setup-guidance guidance-${state}`}>{guidance[state]}</p>
            {localAuthRequired ? <form className="setup-action" onSubmit={(event) => { event.preventDefault(); void runAction("installation.local-auth", { password, confirmation }); }}>
              <strong>设置本机登录密码</strong><small>仅保留不可逆校验器，密码不会写入日志或操作记录。</small>
              <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="至少 12 个字符" value={password} onChange={(event) => setPassword(event.target.value)} />
              <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="再次输入密码" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <Button type="submit" disabled={password.length < 12 || password !== confirmation || actionId === "installation.local-auth"}>{actionId === "installation.local-auth" ? "设置中" : "确认设置"}</Button>
              {actionMessage["installation.local-auth"] ? <span>{actionMessage["installation.local-auth"]}</span> : null}
            </form> : null}
            {conversationRequired ? <div className="setup-inline-action"><span>Codex 已就绪，发送一条消息即可完成最后验证。</span><Link className={buttonVariants()} href="/app/chat">开始真实对话</Link></div> : null}
            {mailNotSelected ? <div className="setup-inline-action"><span>可选：启用后再检查本地收件、投递与恢复。</span><Button variant="outline" type="button" disabled={actionId === "mail.enable"} onClick={() => void runAction("mail.enable")}>{actionId === "mail.enable" ? "启用中" : "启用邮件检测"}</Button>{actionMessage["mail.enable"] ? <small>{actionMessage["mail.enable"]}</small> : null}</div> : null}
            <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />重新检测</Button>
          </article>
        );
      })}
    </section>
  );
}
