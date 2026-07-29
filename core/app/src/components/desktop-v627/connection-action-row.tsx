"use client";

import { BookOpen, CheckCircle2, ExternalLink, Globe2, LoaderCircle, Trash2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { errorMessage, fetchJson } from "./shared";
import type { Connection } from "./connection-types";
import { formatConnectionCountdown, useConnectionStatusSync, type ConnectionSyncResult } from "./use-connection-status-sync";
import { DomainBindingAction } from "./domain-binding-action";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import { PersonalWechatAction } from "./personal-wechat-action";
import { ConnectionClearDialog } from "./connection-clear-dialog";
import { WechatClawAction } from "./wechat-claw-action";
import { DingTalkAction } from "./dingtalk-action";

export function ConnectionActionRow({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  if (connection.id === "wechat-personal") return <><div className="connection-summary-action"><p>{connection.description}</p><PersonalWechatAction connection={connection} refresh={refresh} /></div></>;
  return <DefaultConnectionActionRow connection={connection} refresh={refresh} />;
}

function DefaultConnectionActionRow({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const action = connection.id === "mail" || connection.id === "sites"
    ? <DomainBindingAction connection={connection} refresh={refresh} />
    : connection.id === "notion"
      ? <NotionAction connection={connection} refresh={refresh} />
      : ["xiaohongshu", "twitter"].includes(connection.id)
        ? <OpenCliAction connection={connection} refresh={refresh} />
        : connection.id === "wechat"
          ? <WechatClawAction connection={connection} refresh={refresh} />
          : connection.id === "dingtalk"
            ? <DingTalkAction connection={connection} refresh={refresh} />
          : null;

  return <div className="connection-summary-action"><p>{connection.description}</p>{action}</div>;
}

function OpenCliAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [workflowStarted, setWorkflowStarted] = useState(connection.state !== "ready");
  const ready = connection.state === "ready";
  const setupRequired = connection.state === "needs_setup";
  const bridgeInstallUrl = connection.setup?.browserBridgeInstallUrl;
  const check = async () => {
    setWorkflowStarted(true); setBusy(true); setMessage("");
    try {
      const result = await fetchJson<{ connection: Connection }>(`/api/connections/${connection.id}/status`);
      await refresh();
      setMessage(result.connection.state === "ready" ? "浏览器只读能力已就绪。" : result.connection.state === "needs_setup" ? "浏览器操作环境尚未就绪，请按提示修复。" : "浏览器操作环境不可用。");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const repair = () => {
    setWorkflowStarted(true);
    if (bridgeInstallUrl) window.open(bridgeInstallUrl, "_blank", "noopener,noreferrer");
  };
  const open = async () => {
    setBusy(true); setMessage("");
    try { await fetchJson(`/api/connections/${connection.id}/open`, { method: "POST" }); setMessage("已在浏览器打开"); }
    catch (error) { await refresh().catch(() => undefined); setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const action = ready
    ? <Button className="connection-compact-action" variant="primary" disabled={busy} onClick={() => void open()}>{busy ? <LoaderCircle className="connection-spinner" /> : <ExternalLink />}{busy ? "正在打开…" : connection.primaryAction}</Button>
      : <>{setupRequired && bridgeInstallUrl ? <Button className="connection-compact-action" variant="default" onClick={repair}><ExternalLink />修复浏览器连接</Button> : null}<Button className="connection-compact-action" variant="primary" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle className="connection-spinner" /> : null}{busy ? "正在检测…" : "检测浏览器操作"}</Button></>;
  const checkingPanel = <div className="domain-human-guide" role="status"><strong>正在检查浏览器操作环境</strong><p>{message || "检查本机浏览器连接是否可用，不读取任何平台登录状态。"}</p></div>;
  const repairPanel = <div className="domain-human-guide" role="status"><strong>浏览器连接尚未就绪</strong><p>这是本机浏览器操作环境修复，不是 {connection.name} 账号授权。修复后重新检测即可。</p>{bridgeInstallUrl ? <a href={bridgeInstallUrl} target="_blank" rel="noreferrer">打开修复入口 <ExternalLink /></a> : null}</div>;
  const capabilityPanel = <div className="domain-human-guide" role="status"><strong>正在校验平台只读能力</strong><p>只验证打开、搜索和阅读能力；不会创建或保存平台账号授权。</p></div>;
  const readyPanel = <div className="connection-success-evidence"><CheckCircle2 /><div><strong>浏览器只读能力已经就绪</strong><span>现在可以在浏览器中打开、搜索和阅读 {connection.name}。</span></div></div>;
  return <div className="connection-operation-flow">
    <div className="connection-auth-action">{action}{!workflowStarted && message ? <div className="connection-auth-status" role="status"><span>{message}</span></div> : null}</div>
    {workflowStarted ? <ConnectionOperationSop icon={<Globe2 />} title={`${connection.name} 浏览器操作检测`} summary={ready ? "浏览器操作与平台只读能力均已就绪" : message || "正在检测浏览器操作与平台只读能力"} tone={ready ? "success" : busy ? "working" : "danger"} statusLabel={ready ? "已就绪" : busy ? "检测中" : setupRequired ? "环境待修复" : "检测失败"} steps={openCliSteps({ ready, setupRequired, busy })} stepPanels={{ "0": checkingPanel, "1": repairPanel, "2": capabilityPanel, "3": readyPanel }} /> : null}
  </div>;
}

function NotionAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [userCode, setUserCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [started, setStarted] = useState(connection.state === "connected");
  const [failed, setFailed] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedLocally, setClearedLocally] = useState(false);
  const attempt = useRef(0);
  const connected = connection.state === "connected" && !clearedLocally;
  const probe = useCallback(async (): Promise<ConnectionSyncResult> => {
    const response = await fetch("/api/connections/notion/login/poll", { method: "POST", cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
    if (response.ok) return { state: "completed" };
    if (response.status === 409) return { state: "pending" };
    return { state: "failed", message: response.status === 410 ? "Notion 授权已超时，请重新连接。" : readApiError(payload) };
  }, []);
  const complete = useCallback(() => { setSyncing(false); setFailed(false); setClearedLocally(false); setMessage("Notion 已连接，可以使用相关能力。"); }, []);
  const fail = useCallback((reason: string) => { setSyncing(false); setFailed(true); setMessage(reason); }, []);
  const remaining = useConnectionStatusSync({ active: syncing, complete: connected, probe, refresh, onComplete: complete, onFailure: fail });
  const start = async () => {
    const currentAttempt = ++attempt.current;
    setStarted(true); setBusy(true); setFailed(false); setMessage(""); setVerificationUrl(""); setUserCode("");
    try {
      const result = await fetchJson<{ instructions?: string; verificationUrl?: string; userCode?: string; browserOpened?: boolean }>("/api/connections/notion/login/start", { method: "POST" });
      if (attempt.current !== currentAttempt) return;
      setMessage(result.instructions || "请在浏览器中完成 Notion 工作区授权。"); setVerificationUrl(result.verificationUrl || ""); setUserCode(result.userCode || ""); setSyncing(true);
      if (result.verificationUrl && result.browserOpened === false) window.open(result.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (error) { if (attempt.current === currentAttempt) { setFailed(true); setMessage(errorMessage(error)); } }
    finally { if (attempt.current === currentAttempt) setBusy(false); }
  };
  const cancel = () => {
    attempt.current += 1;
    setBusy(false); setSyncing(false); setFailed(false); setVerificationUrl(""); setUserCode("");
    setStarted(connected);
    setMessage(connected ? "已取消本次重新连接，原有 Notion 连接保持不变。" : "已取消本次 Notion 授权。");
  };
  const clearConfiguration = async () => {
    attempt.current += 1; setClearing(true); setSyncing(false); setMessage("");
    try {
      await fetchJson("/api/connections/notion/configuration", { method: "DELETE" });
      setClearedLocally(true); setStarted(false); setFailed(false); setVerificationUrl(""); setUserCode(""); setClearDialogOpen(false);
      setMessage("Notion 连接配置已清空，可以重新配置工作区。");
      await refresh().catch(() => {});
    } catch (error) { setFailed(true); setMessage(errorMessage(error)); setClearDialogOpen(false); }
    finally { setClearing(false); }
  };
  const label = busy ? "正在启动…" : syncing ? `等待授权 ${formatConnectionCountdown(remaining)}` : "配置";
  const launchPanel = <div className="domain-human-guide" role="status"><strong>{failed ? "授权会话未能建立" : "正在建立授权会话"}</strong><p>{message || "准备 Notion 官方授权页。"}</p>{failed ? <Button onClick={() => void start()}>重新发起</Button> : null}</div>;
  const openPanel = <div className="domain-human-guide" role="status"><strong>打开 Notion 授权页</strong><p>如果浏览器没有自动打开，请使用下面的入口继续。</p>{verificationUrl ? <a href={verificationUrl} target="_blank" rel="noreferrer">打开授权页 <ExternalLink /></a> : null}</div>;
  const approvePanel = <div className="domain-human-guide" role="status"><strong>确认工作区授权</strong><p>选择允许 Personal Agent 访问的工作区并确认，然后返回这里等待自动检测。</p>{userCode ? <code>授权码 {userCode}</code> : null}{verificationUrl ? <a href={verificationUrl} target="_blank" rel="noreferrer">再次打开授权页 <ExternalLink /></a> : null}</div>;
  const completedPanel = <div className="connection-success-evidence"><CheckCircle2 /><div><strong>Notion 工作区已连接</strong><span>授权回调已经收到，相关读取与操作能力可以使用。</span></div></div>;
  return <div className="connection-operation-flow">
    <div className="connection-auth-action">{connected ? <Button className="connection-compact-action" variant="danger" disabled={clearing} onClick={() => setClearDialogOpen(true)}><Trash2 />{clearing ? "正在清空…" : "清空配置"}</Button> : <Button className="connection-compact-action" variant="primary" disabled={busy || syncing} onClick={() => void start()}>{busy || syncing ? <LoaderCircle className="connection-spinner" /> : null}{label}</Button>}{busy || syncing ? <Button className="connection-compact-action" onClick={cancel}><X />取消授权</Button> : null}</div>
    {started ? <ConnectionOperationSop icon={<BookOpen />} title="Notion 工作区授权" summary={connected && !syncing ? "授权回调与能力检测均已完成" : message || "完成授权后会自动检测连接状态"} tone={connected && !syncing ? "success" : failed ? "danger" : "working"} statusLabel={connected && !syncing ? "连接成功" : failed ? "授权失败" : "等待授权"} steps={notionSteps({ busy, syncing, connected: connected && !syncing, failed, verificationUrl })} stepPanels={{ "0": launchPanel, "1": openPanel, "2": approvePanel, "3": completedPanel }} /> : null}
    {clearDialogOpen ? <ConnectionClearDialog connectionName="Notion" configurationSummary="官方 Notion CLI 保存的工作区登录凭据会被注销，当前授权立即停止。" preservedSummary="Personal Agent 已保存的本机内容和操作记录不会被删除。" busy={clearing} onCancel={() => setClearDialogOpen(false)} onConfirm={() => void clearConfiguration()} /> : null}
  </div>;
}

function openCliSteps({ ready, setupRequired, busy }: { ready: boolean; setupRequired: boolean; busy: boolean }): ConnectionOperationStep[] {
  const labels = ["检测浏览器操作环境", "连接浏览器", "校验平台只读能力", "浏览器操作已就绪"];
  const statuses: ConnectionOperationStep["status"][] = ready ? ["passed", "passed", "passed", "passed"]
    : busy ? ["active", "pending", "pending", "pending"]
      : setupRequired ? ["passed", "failed", "pending", "pending"]
        : ["failed", "pending", "pending", "pending"];
  return labels.map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}

function notionSteps({ busy, syncing, connected, failed, verificationUrl }: { busy: boolean; syncing: boolean; connected: boolean; failed: boolean; verificationUrl: string }): ConnectionOperationStep[] {
  const labels = ["建立授权会话", "打开授权页面", "确认工作区授权", "检测连接状态"];
  const statuses: ConnectionOperationStep["status"][] = connected ? ["passed", "passed", "passed", "passed"]
    : failed ? [verificationUrl ? "passed" : "failed", verificationUrl ? "passed" : "pending", verificationUrl ? "failed" : "pending", "pending"]
      : syncing ? ["passed", "passed", "active", "pending"]
        : busy ? ["active", "pending", "pending", "pending"] : ["pending", "pending", "pending", "pending"];
  return labels.map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}

function readApiError(payload: { error?: string | { message?: string } }) {
  return typeof payload.error === "string" ? payload.error : payload.error?.message || "连接授权失败，请重试。";
}
