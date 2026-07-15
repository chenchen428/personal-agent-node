"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildSetupTaskModel, type SetupCheck, type SetupState, type SetupTask } from "@/lib/setup-tasks";
import { Check, CheckCircle2, ChevronDown, Circle, ExternalLink, Mail, MessageCircle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";

type ManagedCloudAction = { state: "idle" | "starting" | "running" | "succeeded" | "failed"; phase: "idle" | "enrollment" | "resources" | "complete"; code?: string };
type SetupSnapshot = { generatedAt?: string; readiness: Record<string, SetupState>; checks: SetupCheck[]; actions?: { managedCloud?: ManagedCloudAction } };

const CODEX_GUIDE = "https://developers.openai.com/codex/cli/";
const RELEASES = "https://github.com/chenchen428/personal-agent-node/releases";
const labels: Record<SetupState, string> = {
  ready: "可用",
  checking: "检查中",
  "action-required": "需要处理",
  blocked: "等待前置项",
  "not-selected": "可选",
};
const detailGroups = [
  { key: "core", label: "本机与 Codex", sources: ["installation", "agent"] },
  { key: "online", label: "公网与邮箱", sources: ["connectivity", "mail-identity"] },
  { key: "optional", label: "邮件与渠道", sources: ["local-mail", "optional-channels"] },
];

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

  const renderAction = (requestedAction: string) => {
    if (requestedAction === "installation.local-auth") return <form className="todo-auth-form" onSubmit={(event) => { event.preventDefault(); void runAction(requestedAction, { password, confirmation }); }}>
      <div className="todo-auth-fields">
        <Input aria-label="本机登录密码" type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="至少 12 个字符" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Input aria-label="确认本机登录密码" type="password" autoComplete="new-password" minLength={12} maxLength={256} placeholder="再次输入密码" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </div>
      <Button type="submit" disabled={password.length < 12 || password !== confirmation || actionId === requestedAction}>{actionId === requestedAction ? "设置中" : "确认设置"}</Button>
      {actionMessage[requestedAction] ? <small>{actionMessage[requestedAction]}</small> : null}
    </form>;

    if (["installation.repair", "installation.service-repair"].includes(requestedAction)) return <a className={buttonVariants({ variant: "outline" })} href={RELEASES} target="_blank" rel="noreferrer"><Wrench className="size-3.5" />打开安装包<ExternalLink className="size-3.5" /></a>;

    if (["agent.codex.install-guide", "agent.codex.update-guide", "agent.codex.login-guide"].includes(requestedAction)) return <a className={buttonVariants({ variant: "outline" })} href={CODEX_GUIDE} target="_blank" rel="noreferrer">Codex 官方指南<ExternalLink className="size-3.5" /></a>;

    if (requestedAction === "agent.open-chat") return <Link className={buttonVariants()} href="/app/chat"><MessageCircle className="size-3.5" />开始真实对话</Link>;

    if (["agent.codex.retry", "connectivity.retry"].includes(requestedAction)) return <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />重新检测</Button>;

    if (["connectivity.choose-mode", "connectivity.managed-authorize", "connectivity.repair"].includes(requestedAction)) {
      const cloudAction = snapshot?.actions?.managedCloud;
      const cloudPending = ["starting", "running"].includes(cloudAction?.state || "idle");
      const cloudMessage = cloudAction?.state === "failed" ? `页面验证未完成（${cloudAction.code || "请重试"}）。`
        : cloudAction?.phase === "resources" ? "本机接入已确认，正在验证公网域名和 Agent 邮箱。"
          : cloudPending ? "已打开 chenjianhui.site，请在已登录的页面确认这台电脑。"
            : cloudAction?.state === "succeeded" ? "页面验证已完成，正在刷新资源状态。" : "";
      return <div className="todo-cloud-action">
        <Button type="button" disabled={actionId === "connectivity.managed-authorize" || cloudPending} onClick={() => void runAction("connectivity.managed-authorize")}>{cloudPending ? "等待页面确认" : "验证公网与邮箱"}</Button>
        {cloudMessage || actionMessage["connectivity.managed-authorize"] ? <small>{cloudMessage || actionMessage["connectivity.managed-authorize"]}</small> : null}
      </div>;
    }

    if (requestedAction === "mail.enable") return <div className="todo-cloud-action">
      <Button variant="outline" type="button" disabled={actionId === requestedAction} onClick={() => void runAction(requestedAction)}><Mail className="size-3.5" />{actionId === requestedAction ? "启用中" : "启用邮件检测"}</Button>
      {actionMessage[requestedAction] ? <small>{actionMessage[requestedAction]}</small> : null}
    </div>;

    if (["mail.test-delivery", "mail.test-recovery"].includes(requestedAction)) return <Link className={buttonVariants({ variant: "outline" })} href="/app/mail"><Mail className="size-3.5" />打开邮件页</Link>;
    return null;
  };

  const checks = snapshot?.checks || [];
  const tasks = buildSetupTaskModel(checks);
  const requiredDone = !loading && !error && tasks.totalRequired > 0 && tasks.requiredTasks.length === 0 && tasks.blockedChecks.length === 0;
  const headline = loading ? "正在检查这台电脑" : error ? "暂时无法完成检查" : requiredDone ? "本机已经可以使用" : `${tasks.requiredTasks.length} 项待完成`;
  const summary = loading ? "正在读取安装、Codex 和对话链路的本机事实。" : error || (requiredDone ? "本机安装和 Codex Agent 已通过核心检查。" : "完成下面的任务即可使用；等待项会在前置任务完成后自动继续检查。");

  return <section className="setup-workspace" aria-label="Setup readiness" aria-live="polite">
    <section className={`setup-summary-band ${requiredDone ? "is-ready" : ""}`}>
      <div className="setup-summary-copy">
        <p className="setup-summary-kicker"><i className={loading ? "state-checking" : requiredDone ? "state-ready" : error ? "state-error" : "state-warning"} />CORE READINESS</p>
        <h2>{headline}</h2>
        <p>{summary}</p>
      </div>
      <div className="setup-progress-block">
        <div><strong>{tasks.completedRequired}</strong><span>/ {tasks.totalRequired || 10}</span></div>
        <small>核心检查已完成</small>
        <div className="setup-progress-track" role="progressbar" aria-label="核心检查进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tasks.progress}><i style={{ width: `${tasks.progress}%` }} /></div>
      </div>
    </section>

    <section className="setup-todo-section" aria-labelledby="required-tasks-title">
      <header className="setup-section-heading">
        <div><span>01</span><div><h2 id="required-tasks-title">现在处理</h2><p>只列出当前可执行、且会影响本机使用的事项。</p></div></div>
        <Badge variant={requiredDone ? "ready" : tasks.requiredTasks.length ? "warning" : "neutral"}>{loading ? "检查中" : requiredDone ? "全部完成" : `${tasks.requiredTasks.length} 项`}</Badge>
      </header>
      {tasks.requiredTasks.length ? <ol className="setup-todo-list">
        {tasks.requiredTasks.map((task, index) => <TodoItem key={task.check.id} task={task} index={index + 1} action={renderAction(task.actionId)} />)}
      </ol> : <div className={`setup-empty-state ${requiredDone ? "is-ready" : ""}`}>
        {requiredDone ? <CheckCircle2 /> : <Circle />}
        <div><strong>{loading ? "正在生成任务清单" : requiredDone ? "没有阻塞本机使用的任务" : error || "正在等待检测结果"}</strong><span>{requiredDone ? "你可以直接进入对话；公网和邮件仍可稍后配置。" : "检测完成后，这里只会保留需要你处理的事项。"}</span></div>
      </div>}
    </section>

    <div className="setup-secondary-grid">
      <section className="setup-todo-section setup-optional" aria-labelledby="optional-tasks-title">
        <header className="setup-section-heading">
          <div><span>02</span><div><h2 id="optional-tasks-title">以后配置</h2><p>不影响本机使用，按你的需要启用。</p></div></div>
          <Badge variant="neutral">可选</Badge>
        </header>
        <ul className="setup-optional-list">
          {tasks.optionalTasks.map((task) => <li key={task.check.id}><div className="optional-task-copy"><Circle /><div><strong>{task.title}</strong><span>{task.check.guidance}</span></div></div><div className="optional-task-action">{renderAction(task.actionId)}</div></li>)}
        </ul>
      </section>

      <section className="setup-details-section" aria-labelledby="check-details-title">
        <header className="setup-section-heading">
          <div><span>03</span><div><h2 id="check-details-title">检测详情</h2><p>查看全部检测事实和状态。</p></div></div>
          <Button variant="outline" size="sm" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "size-3.5 spin" : "size-3.5"} />重新检测</Button>
        </header>
        <details className="setup-check-details">
          <summary><ShieldCheck /><span>全部 {checks.length || 21} 项检查</span><ChevronDown /></summary>
          <div className="setup-detail-groups">
            {detailGroups.map((group) => {
              const groupChecks = checks.filter((check) => group.sources.includes(check.group));
              return <section key={group.key}><h3>{group.label}</h3><ul>{groupChecks.map((check) => <li key={check.id} className={`detail-${check.state}`}><StatusIcon state={check.state} /><span>{check.summary}</span><em>{labels[check.state]}</em></li>)}</ul></section>;
            })}
          </div>
        </details>
      </section>
    </div>
  </section>;
}

function TodoItem({ task, index, action }: { task: SetupTask; index: number; action: React.ReactNode }) {
  return <li className="setup-todo-item">
    <div className="todo-index"><span>{String(index).padStart(2, "0")}</span><Circle /></div>
    <div className="todo-main">
      <div className="todo-title-row"><div><Badge variant="warning">{task.category}</Badge><h3>{task.title}</h3></div><span className="todo-state"><i />需要处理</span></div>
      <p>{task.check.guidance}</p>
      <details className="todo-why"><summary>为什么需要这一步<ChevronDown /></summary><span>{task.check.why}</span></details>
      {task.waitingCount ? <small className="todo-waiting">完成后将继续检查同组的 {task.waitingCount} 个等待项。</small> : null}
      <div className="todo-action">{action}</div>
    </div>
  </li>;
}

function StatusIcon({ state }: { state: SetupState }) {
  if (state === "ready") return <Check className="detail-icon" />;
  if (state === "checking") return <RefreshCw className="detail-icon spin" />;
  return <Circle className="detail-icon" />;
}
