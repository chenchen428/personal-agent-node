"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildSetupTaskModel, validateLocalPasswordInput, type SetupCheck, type SetupState, type SetupTask } from "@/lib/setup-tasks";
import { Check, CheckCircle2, ChevronDown, Circle, ExternalLink, Mail, MessageCircle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";

type ManagedCloudAction = { state: "idle" | "starting" | "running" | "succeeded" | "failed"; phase: "idle" | "enrollment" | "resources" | "complete"; code?: string };
type SetupSnapshot = { generatedAt?: string; readiness: Record<string, SetupState>; checks: SetupCheck[]; actions?: { managedCloud?: ManagedCloudAction } };

const CODEX_GUIDE = "https://developers.openai.com/codex/cli/";
const RELEASES = "https://github.com/chenchen428/personal-agent-node/releases";
const labels: Record<SetupState, string> = { ready: "可用", checking: "检查中", "action-required": "需处理", blocked: "等待", "not-selected": "可选" };
const badgeTone: Record<SetupState, "ready" | "warning" | "error" | "neutral"> = { ready: "ready", checking: "neutral", "action-required": "warning", blocked: "error", "not-selected": "neutral" };
const detailGroups = [
  { key: "core", label: "本机与 Codex", sources: ["installation", "agent"] },
  { key: "online", label: "公网与 Agent 邮箱", sources: ["connectivity", "mail-identity"] },
  { key: "optional", label: "本地邮件与渠道", sources: ["local-mail", "optional-channels"] },
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
    if (requestedAction === "installation.local-auth") {
      const passwordIssue = validateLocalPasswordInput(password, confirmation);
      return (
      <form className="grid gap-3" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (passwordIssue) {
          setActionMessage((current) => ({ ...current, [requestedAction]: passwordIssue }));
          return;
        }
        void runAction(requestedAction, { password, confirmation });
      }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="本机登录密码" type="password" autoComplete="new-password" required minLength={12} maxLength={256} placeholder="至少 12 个字符" value={password} onChange={(event) => setPassword(event.target.value)} />
          <Input aria-label="确认本机登录密码" type="password" autoComplete="new-password" required minLength={12} maxLength={256} placeholder="再次输入密码" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={actionId === requestedAction}>{actionId === requestedAction ? "设置中" : "确认设置"}</Button>
          <small className="text-xs text-[var(--muted)]" role="status">{actionMessage[requestedAction] || (password || confirmation ? passwordIssue || "两次输入一致，可以确认设置。" : "密码仅保存在本机，并以不可逆校验器存储。")}</small>
        </div>
      </form>
      );
    }

    if (["installation.repair", "installation.service-repair"].includes(requestedAction)) return <a className={buttonVariants({ variant: "outline", size: "sm" })} href={RELEASES} target="_blank" rel="noreferrer"><Wrench className="size-3.5" />打开安装包<ExternalLink className="size-3.5" /></a>;
    if (["agent.codex.install-guide", "agent.codex.update-guide", "agent.codex.login-guide"].includes(requestedAction)) return <a className={buttonVariants({ variant: "outline", size: "sm" })} href={CODEX_GUIDE} target="_blank" rel="noreferrer">Codex 官方指南<ExternalLink className="size-3.5" /></a>;
    if (requestedAction === "agent.open-chat") return <Link className={buttonVariants({ size: "sm" })} href="/app/chat"><MessageCircle className="size-3.5" />开始真实对话</Link>;
    if (["agent.codex.retry", "connectivity.retry"].includes(requestedAction)) return <Button variant="outline" size="sm" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />重新检测</Button>;

    if (["connectivity.choose-mode", "connectivity.managed-authorize", "connectivity.repair"].includes(requestedAction)) {
      const cloudAction = snapshot?.actions?.managedCloud;
      const cloudPending = ["starting", "running"].includes(cloudAction?.state || "idle");
      const cloudMessage = cloudAction?.state === "failed" ? cloudFailureMessage(cloudAction.code)
        : cloudAction?.phase === "resources" ? "本机接入已确认，正在验证公网域名和 Agent 邮箱。"
          : cloudPending ? "已打开 chenjianhui.site，请在已登录的页面确认这台电脑。"
            : cloudAction?.state === "succeeded" ? "页面验证已完成，正在刷新资源状态。" : "";
      return <div className="grid justify-items-start gap-2">
        <Button size="sm" type="button" disabled={actionId === "connectivity.managed-authorize" || cloudPending} onClick={() => void runAction("connectivity.managed-authorize")}>{cloudPending ? "等待页面确认" : "验证公网与邮箱"}</Button>
        {cloudMessage || actionMessage["connectivity.managed-authorize"] ? <small className="text-xs leading-relaxed text-[var(--muted)]" role="status">{cloudMessage || actionMessage["connectivity.managed-authorize"]}</small> : null}
      </div>;
    }

    if (requestedAction === "mail.enable") return <div className="grid justify-items-start gap-2">
      <Button variant="outline" size="sm" type="button" disabled={actionId === requestedAction} onClick={() => void runAction(requestedAction)}><Mail className="size-3.5" />{actionId === requestedAction ? "启用中" : "启用邮件检测"}</Button>
      {actionMessage[requestedAction] ? <small className="text-xs text-[var(--muted)]" role="status">{actionMessage[requestedAction]}</small> : null}
    </div>;
    if (["mail.test-delivery", "mail.test-recovery"].includes(requestedAction)) return <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/app/mail"><Mail className="size-3.5" />打开邮件页</Link>;
    return null;
  };

  const checks = snapshot?.checks || [];
  const tasks = buildSetupTaskModel(checks);
  const coreReady = !loading && !error && tasks.totalRequired > 0 && tasks.completedRequired === tasks.totalRequired && tasks.blockedChecks.length === 0;
  const currentDone = !loading && !error && tasks.requiredTasks.length === 0 && tasks.blockedChecks.length === 0;
  const headline = loading ? "正在检查这台电脑" : error ? "暂时无法完成检查" : currentDone ? "当前设置已经完成" : `${tasks.requiredTasks.length} 项待完成`;
  const summary = loading ? "正在读取安装、Codex 和对话链路的本机事实。" : error || (currentDone ? "安装、Codex、公网域名与 Agent 邮箱已经完成检查。" : coreReady ? "本机已经可用；继续完成公网域名与 Agent 邮箱验证。" : "先完成本机、Codex、公网域名与 Agent 邮箱的当前事项。" );

  return <section className="grid gap-6 pt-8" aria-label="Setup readiness" aria-live="polite">
    <Card className="overflow-hidden border-0 bg-[var(--surface-dark)] text-[#d2cec6] shadow-[0_20px_60px_rgba(20,20,19,.12)]">
      <CardContent className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
        <div className="min-w-0">
          <div className="mb-5 flex items-center gap-2.5 text-[11px] font-medium tracking-[.12em] text-[#c8c4bc]">
            <span className={`size-2 rounded-full ${loading ? "animate-pulse bg-[var(--coral)]" : coreReady ? "bg-[var(--success)]" : error ? "bg-[var(--error)]" : "bg-[var(--warning)]"}`} />
            CORE READINESS
          </div>
          <h2 className="m-0 text-4xl leading-none text-[#faf9f5] sm:text-5xl">{headline}</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#d2cec6]">{summary}</p>
        </div>
        <div className="grid gap-3">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-1.5"><strong className="font-[var(--display)] text-4xl font-normal leading-none text-[#faf9f5]">{tasks.completedRequired}</strong><span className="font-[var(--mono)] text-xs text-[#aaa69f]">/ {tasks.totalRequired || 10}</span></div>
            <span className="text-xs text-[#c8c4bc]">核心检查</span>
          </div>
          <Progress className="bg-[#484541] [&_[data-slot=progress-indicator]]:bg-[var(--coral)]" value={tasks.progress} aria-label="核心检查进度" />
        </div>
      </CardContent>
    </Card>

    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
      <Card className="min-w-0 shadow-[0_10px_32px_rgba(20,20,19,.05)]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-[var(--hairline)] pb-5">
          <div className="min-w-0">
            <div className="mb-2 font-[var(--mono)] text-[10px] tracking-[.12em] text-[var(--coral)]">01 · NOW</div>
            <CardTitle>现在处理</CardTitle>
            <CardDescription className="mt-1">本机核心保持独立；这里集中完成当前安装引导。</CardDescription>
          </div>
          <Badge variant={currentDone ? "ready" : tasks.requiredTasks.length ? "warning" : "neutral"}>{loading ? "检查中" : currentDone ? "已完成" : `${tasks.requiredTasks.length} 项`}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:p-5">
          {tasks.requiredTasks.length ? <ol className="grid list-none gap-3 p-0">
            {tasks.requiredTasks.map((task, index) => <TodoItem key={task.check.id} task={task} index={index + 1} action={renderAction(task.actionId)} />)}
          </ol> : <div className="flex min-h-36 items-center gap-4 rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--surface-soft)] p-5">
            {currentDone ? <CheckCircle2 className="size-7 shrink-0 text-[var(--success)]" /> : <Circle className="size-7 shrink-0 text-[var(--muted-soft)]" />}
            <div><strong className="block text-sm font-medium text-[var(--ink)]">{loading ? "正在生成任务清单" : currentDone ? "当前引导已经完成" : error || "正在等待检测结果"}</strong><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{currentDone ? "本机、Codex、公网域名与 Agent 邮箱均已完成检查。" : "检测完成后，这里只会留下需要你处理的事项。"}</span></div>
          </div>}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden shadow-[0_10px_32px_rgba(20,20,19,.05)]">
        <Tabs defaultValue="optional">
          <CardHeader className="gap-4 border-b border-[var(--hairline)] pb-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="mb-2 font-[var(--mono)] text-[10px] tracking-[.12em] text-[var(--coral)]">02 · OVERVIEW</div><CardTitle>完成自己的配置</CardTitle></div>
              <Button variant="outline" size="icon" type="button" aria-label="重新检测" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
            </div>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="optional">以后配置</TabsTrigger>
              <TabsTrigger value="details">检测详情</TabsTrigger>
            </TabsList>
          </CardHeader>
          <TabsContent value="optional" className="m-0">
            <CardContent className="grid p-0">
              {tasks.optionalTasks.length ? tasks.optionalTasks.map((task, index) => <div key={task.check.id}>
                {index ? <Separator /> : null}
                <div className="grid gap-4 p-5">
                  <div className="flex items-start gap-3"><Circle className="mt-0.5 size-4 shrink-0 text-[var(--muted-soft)]" /><div className="min-w-0"><strong className="block text-sm font-medium text-[var(--ink)]">{task.title}</strong><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{task.check.guidance}</span></div></div>
                  <div className="pl-7">{renderAction(task.actionId)}</div>
                </div>
              </div>) : <div className="p-5 text-sm text-[var(--muted)]">当前没有需要配置的可选能力。</div>}
            </CardContent>
          </TabsContent>
          <TabsContent value="details" className="m-0">
            <CardContent className="grid gap-5 p-5">
              {detailGroups.map((group, groupIndex) => {
                const groupChecks = checks.filter((check) => group.sources.includes(check.group));
                return <section key={group.key} className="grid gap-2.5">
                  {groupIndex ? <Separator className="mb-2" /> : null}
                  <h3 className="m-0 font-[var(--mono)] text-[10px] font-medium tracking-[.08em] text-[var(--muted)] uppercase">{group.label}</h3>
                  <ul className="grid list-none gap-1 p-0">{groupChecks.map((check) => <li key={check.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-xs text-[var(--body)]"><StatusIcon state={check.state} /><span>{check.summary}</span><Badge variant={badgeTone[check.state]}>{labels[check.state]}</Badge></li>)}</ul>
                </section>;
              })}
              {!checks.length ? <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><ShieldCheck className="size-4" />等待检测结果</div> : null}
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  </section>;
}

function TodoItem({ task, index, action }: { task: SetupTask; index: number; action: React.ReactNode }) {
  return <li>
    <Card className="bg-[var(--surface-soft)]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--canvas)] font-[var(--mono)] text-[10px] text-[var(--coral)] ring-1 ring-[var(--hairline)]">{String(index).padStart(2, "0")}</span>
          <div className="min-w-0"><Badge variant="warning">{task.category}</Badge><h3 className="mt-2 mb-0 text-2xl leading-tight">{task.title}</h3></div>
        </div>
        <Badge variant="warning">需处理</Badge>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 pt-0 pb-5 sm:pl-15">
        <p className="m-0 text-sm leading-6 text-[var(--body)]">{task.check.guidance}</p>
        <details className="group text-xs text-[var(--muted)]"><summary className="flex w-max cursor-pointer list-none items-center gap-1">为什么需要这一步<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><p className="mt-2 mb-0 border-l-2 border-[var(--hairline)] pl-3 leading-relaxed">{task.check.why}</p></details>
        {task.waitingCount ? <small className="text-xs text-[var(--coral)]">完成后会继续检查同组的 {task.waitingCount} 个等待项。</small> : null}
        <div>{action}</div>
      </CardContent>
    </Card>
  </li>;
}

function StatusIcon({ state }: { state: SetupState }) {
  if (state === "ready") return <Check className="size-3.5 text-[var(--success)]" />;
  if (state === "checking") return <RefreshCw className="size-3.5 animate-spin text-[var(--coral)]" />;
  if (state === "blocked") return <Circle className="size-3.5 text-[var(--error)]" />;
  return <Circle className="size-3.5 text-[var(--warning)]" />;
}

function cloudFailureMessage(code = "") {
  const messages: Record<string, string> = {
    CLOUD_AUTH_DENIED: "页面验证已取消，请重新验证并确认这台电脑。",
    CLOUD_AUTH_EXPIRED: "页面验证已过期，请重新发起验证。",
    CLOUD_AUTH_FAILED: "Cloud 登录状态未通过，请确认 chenjianhui.site 已登录后重试。",
    CLOUD_REQUEST_FAILED: "Cloud 授权接口暂时未完成请求，请确认 Cloud 已发布最新版本后重试。",
    DEPENDENCY_UNAVAILABLE: "Cloud 授权服务暂时不可用，请稍后重新验证。",
  };
  return messages[code] || `页面验证未完成（${code || "请重试"}）。`;
}
