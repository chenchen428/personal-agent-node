"use client";

import { BookOpen, ExternalLink, Globe2, LoaderCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { WechatConnectPanel } from "@/components/wechat-connect-panel";
import { Button } from "../desktop-v72/primitives";
import { errorMessage, fetchJson } from "./shared";
import type { Connection } from "./connection-types";
import { formatConnectionCountdown, useConnectionStatusSync, type ConnectionSyncResult } from "./use-connection-status-sync";
import { DomainBindingAction } from "./domain-binding-action";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import { PersonalWechatAction } from "./personal-wechat-action";

export function ConnectionActionRow({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  if (connection.id === "wechat-personal") return <><div className="connection-summary-action"><p>{connection.description}</p><PersonalWechatAction connection={connection} refresh={refresh} /></div></>;
  return <DefaultConnectionActionRow connection={connection} refresh={refresh} />;
}

function DefaultConnectionActionRow({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [panelAttempt, setPanelAttempt] = useState(0);
  const [scanActive, setScanActive] = useState(false);
  const scanConnected = connection.state === "connected";
  const openScanPanel = () => { setExpanded(true); setPanelAttempt((value) => value + 1); };
  const action = connection.id === "mail" || connection.id === "sites"
    ? <DomainBindingAction connection={connection} refresh={refresh} />
    : connection.id === "notion"
      ? <NotionAction connection={connection} refresh={refresh} />
      : ["xiaohongshu", "twitter"].includes(connection.id)
        ? <OpenCliAction connection={connection} refresh={refresh} />
        : connection.id === "wechat"
          ? <Button className="connection-compact-action" variant="primary" disabled={scanActive} onClick={openScanPanel}>{scanActive ? <><LoaderCircle className="connection-spinner" />等待扫码确认</> : scanConnected ? "重新连接" : connection.primaryAction}</Button>
          : null;

  return <>
    <div className="connection-summary-action"><p>{connection.description}</p>{action}</div>
    {expanded && connection.id === "wechat" ? <WechatConnectPanel key={panelAttempt} connected={scanConnected} autoStart reconnectOnMount={scanConnected} onActiveChange={setScanActive} onConnected={refresh} compact /> : null}
  </>;
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
  return <div className="connection-operation-flow">
    <div className="connection-auth-action">{action}{!workflowStarted && message ? <div className="connection-auth-status" role="status"><span>{message}</span></div> : null}</div>
    {workflowStarted ? <ConnectionOperationSop icon={<Globe2 />} title={`${connection.name} 浏览器操作检测`} summary={ready ? "浏览器操作与平台只读能力均已就绪" : message || "正在检测浏览器操作与平台只读能力"} tone={ready ? "success" : busy ? "working" : "danger"} statusLabel={ready ? "已就绪" : busy ? "检测中" : setupRequired ? "环境待修复" : "检测失败"} steps={openCliSteps({ ready, setupRequired, busy })}>
      {!ready ? <div className="domain-human-guide" role="status"><strong>{setupRequired ? "浏览器连接尚未就绪" : "浏览器操作环境不可用"}</strong><p>{setupRequired ? `这是本机浏览器操作环境修复，不是${connection.name}账号授权。修复后重新检测即可，Personal Agent 不会读取平台登录状态。` : "请完成 Personal Agent 更新或修复，再返回此页检测浏览器操作。"}</p></div> : <div className="connection-success-evidence"><strong>浏览器只读能力已经就绪</strong><span>现在可以在浏览器中打开、搜索和阅读 {connection.name}；不会创建或保存平台账号授权。</span></div>}
    </ConnectionOperationSop> : null}
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
  const connected = connection.state === "connected";
  const probe = useCallback(async (): Promise<ConnectionSyncResult> => {
    const response = await fetch("/api/connections/notion/login/poll", { method: "POST", cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
    if (response.ok) return { state: "completed" };
    if (response.status === 409) return { state: "pending" };
    return { state: "failed", message: response.status === 410 ? "Notion 授权已超时，请重新连接。" : readApiError(payload) };
  }, []);
  const complete = useCallback(() => { setSyncing(false); setFailed(false); setMessage("Notion 已连接，可以使用相关能力。"); }, []);
  const fail = useCallback((reason: string) => { setSyncing(false); setFailed(true); setMessage(reason); }, []);
  const remaining = useConnectionStatusSync({ active: syncing, complete: connected, probe, refresh, onComplete: complete, onFailure: fail });
  const start = async () => {
    setStarted(true); setBusy(true); setFailed(false); setMessage(""); setVerificationUrl(""); setUserCode("");
    try {
      const result = await fetchJson<{ instructions?: string; verificationUrl?: string; userCode?: string; browserOpened?: boolean }>("/api/connections/notion/login/start", { method: "POST" });
      setMessage(result.instructions || "请在浏览器中完成 Notion 工作区授权。"); setVerificationUrl(result.verificationUrl || ""); setUserCode(result.userCode || ""); setSyncing(true);
      if (result.verificationUrl && result.browserOpened === false) window.open(result.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (error) { setFailed(true); setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const label = busy ? "正在启动…" : syncing ? `等待授权 ${formatConnectionCountdown(remaining)}` : connected ? "重新连接" : "连接 Notion";
  return <div className="connection-operation-flow">
    <div className="connection-auth-action"><Button className="connection-compact-action" variant="primary" disabled={busy || syncing} onClick={() => void start()}>{busy || syncing ? <LoaderCircle className="connection-spinner" /> : null}{label}</Button></div>
    {started ? <ConnectionOperationSop icon={<BookOpen />} title="Notion 工作区授权" summary={connected ? "授权回调与能力检测均已完成" : message || "完成授权后会自动检测连接状态"} tone={connected ? "success" : failed ? "danger" : "working"} statusLabel={connected ? "连接成功" : failed ? "授权失败" : "等待授权"} steps={notionSteps({ busy, syncing, connected, failed, verificationUrl })}>
      {!connected ? <div className="domain-human-guide" role="status"><strong>需要你在 Notion 授权页完成操作</strong><p>打开授权页，选择允许 Personal Agent 访问的工作区并确认授权，然后返回这里等待自动检测。不要关闭当前页面。</p>{userCode ? <code>授权码 {userCode}</code> : null}{verificationUrl && syncing ? <a href={verificationUrl} target="_blank" rel="noreferrer">打开授权页 <ExternalLink /></a> : null}</div> : <div className="connection-success-evidence"><strong>Notion 工作区已连接</strong><span>授权回调已经收到，相关读取与操作能力可以使用。</span></div>}
    </ConnectionOperationSop> : null}
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
