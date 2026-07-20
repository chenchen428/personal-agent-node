"use client";

import { CheckCircle2, ExternalLink, LoaderCircle, MessageCircle, PlugZap, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../desktop-v72/primitives";
import { ConnectionClearDialog } from "./connection-clear-dialog";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import type { Connection } from "./connection-types";
import { errorMessage, fetchJson } from "./shared";
import { formatConnectionCountdown, useConnectionStatusSync, type ConnectionSyncResult } from "./use-connection-status-sync";

export function DingTalkAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [observed, setObserved] = useState(connection);
  const [expanded, setExpanded] = useState(connection.state !== "connected");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(connection.state === "error");
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const connected = observed.state === "connected";
  const configured = Boolean(observed.details?.configured);

  useEffect(() => {
    if (!saving && !syncing && !clearing) setObserved(connection);
  }, [clearing, connection, saving, syncing]);

  const probe = useCallback(async (): Promise<ConnectionSyncResult> => {
    const result = await fetchJson<{ connection: Connection }>("/api/connections/dingtalk/status");
    setObserved(result.connection);
    if (result.connection.state === "connected") return { state: "completed" };
    if (result.connection.state === "error") return { state: "failed", message: result.connection.statusLabel };
    return { state: "pending" };
  }, []);
  const complete = useCallback(() => { setSyncing(false); setFailed(false); setMessage("钉钉 Stream 已连接，可以从钉钉发送文字消息。"); }, []);
  const fail = useCallback((reason: string) => { setSyncing(false); setFailed(true); setMessage(reason); }, []);
  const remaining = useConnectionStatusSync({ active: syncing, complete: connected, probe, refresh, onComplete: complete, onFailure: fail });

  const configure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setFailed(false); setMessage(""); setExpanded(true);
    try {
      const result = await fetchJson<{ connection: Connection }>("/api/connections/dingtalk/configuration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      setObserved(result.connection); setClientSecret("");
      if (result.connection.state === "connected") complete();
      else { setSyncing(true); setMessage("凭据已校验并保存，正在建立钉钉 Stream 长连接。"); }
      await refresh().catch(() => {});
    } catch (error) { setFailed(true); setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  };

  const clearConfiguration = async () => {
    setClearing(true); setSyncing(false);
    try {
      await fetchJson("/api/connections/dingtalk/configuration", { method: "DELETE" });
      setObserved({ ...connection, state: "needs_setup", statusLabel: "待连接", details: { ...connection.details, configured: false, clientId: "" } });
      setClientId(""); setClientSecret(""); setFailed(false); setExpanded(true); setClearDialogOpen(false);
      setMessage("钉钉连接配置已清空，可以配置其他企业内部应用机器人。");
      await refresh().catch(() => {});
    } catch (error) { setFailed(true); setMessage(errorMessage(error)); setClearDialogOpen(false); }
    finally { setClearing(false); }
  };

  const formPanel = <form className="dingtalk-credential-form" onSubmit={(event) => void configure(event)}>
    <div><label htmlFor="dingtalk-client-id">Client ID</label><input id="dingtalk-client-id" autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} required /></div>
    <div><label htmlFor="dingtalk-client-secret">Client Secret</label><input id="dingtalk-client-secret" type="password" autoComplete="new-password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} required /></div>
    <footer><a href="https://open.dingtalk.com/" target="_blank" rel="noreferrer">钉钉开放平台 <ExternalLink /></a><Button variant="primary" disabled={saving || syncing}>{saving ? <LoaderCircle className="connection-spinner" /> : <PlugZap />}{saving ? "正在校验…" : "校验并连接"}</Button></footer>
    {message && failed ? <p role="alert">{message}</p> : null}
  </form>;
  const connectingPanel = <div className="domain-human-guide" role="status"><strong>正在建立 Stream 长连接</strong><p>{message || "钉钉已接受应用凭据，正在注册机器人消息回调。"}{syncing ? ` 剩余 ${formatConnectionCountdown(remaining)}` : ""}</p></div>;
  const completedPanel = <div className="connection-success-evidence"><CheckCircle2 /><div><strong>钉钉 Stream 已连接</strong><span>{observed.details?.clientId ? `应用 ${observed.details.clientId} 已绑定当前 Space。` : "机器人消息回调已经就绪。"}</span></div></div>;
  const steps = dingtalkSteps({ saving, syncing, connected, failed, configured });
  return <div className="dingtalk-connection-flow">
    <div className="connection-auth-action">{configured ? <Button className="connection-compact-action" variant="danger" disabled={clearing} onClick={() => setClearDialogOpen(true)}><Trash2 />{clearing ? "正在清空…" : "清空配置"}</Button> : <Button className="connection-compact-action" variant="primary" onClick={() => setExpanded(true)}><PlugZap />配置</Button>}</div>
    <ConnectionOperationSop icon={<MessageCircle />} title="钉钉 Stream 连接" summary={connected ? "官方 Stream 长连接已经就绪" : message || "使用企业内部应用机器人凭据连接当前 Space"} tone={connected ? "success" : failed ? "danger" : saving || syncing ? "working" : "neutral"} statusLabel={connected ? "连接成功" : failed ? "连接失败" : saving ? "校验凭据" : syncing ? "建立连接" : "等待配置"} steps={steps} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)} stepPanels={{ "0": formPanel, "1": failed ? formPanel : connectingPanel, "2": connectingPanel, "3": completedPanel }} />
    {clearDialogOpen ? <ConnectionClearDialog connectionName="钉钉" configurationSummary="当前 Space 保存的 Client ID、Client Secret 和 Stream 连接都会被清空。" preservedSummary="本机对话记录和用户文件不会被删除。" releaseSummary="该钉钉应用可以在另一个 Space 重新配置。" busy={clearing} onCancel={() => setClearDialogOpen(false)} onConfirm={() => void clearConfiguration()} /> : null}
  </div>;
}

function dingtalkSteps({ saving, syncing, connected, failed, configured }: { saving: boolean; syncing: boolean; connected: boolean; failed: boolean; configured: boolean }): ConnectionOperationStep[] {
  const statuses: ConnectionOperationStep["status"][] = connected ? ["passed", "passed", "passed", "passed"]
    : failed ? ["passed", "failed", "pending", "pending"]
      : syncing || configured ? ["passed", "passed", "active", "pending"]
        : saving ? ["passed", "active", "pending", "pending"] : ["active", "pending", "pending", "pending"];
  return ["填写应用凭据", "校验并保存", "建立 Stream 连接", "完成连接"].map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}
