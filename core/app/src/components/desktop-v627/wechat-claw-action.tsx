"use client";

import { LoaderCircle, QrCode, Trash2 } from "lucide-react";
import { useState } from "react";
import { WechatConnectPanel } from "@/components/wechat-connect-panel";
import { Button } from "../desktop-v72/primitives";
import { ConnectionClearDialog } from "./connection-clear-dialog";
import type { Connection } from "./connection-types";
import { errorMessage, fetchJson } from "./shared";

export function WechatClawAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [panelAttempt, setPanelAttempt] = useState(0);
  const [scanActive, setScanActive] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedLocally, setClearedLocally] = useState(false);
  const [message, setMessage] = useState("");
  const configured = !clearedLocally && (connection.details?.configured === true || connection.state === "connected");
  const openScanPanel = () => { setExpanded(true); setPanelAttempt((value) => value + 1); setMessage(""); };
  const clearConfiguration = async () => {
    setClearing(true); setMessage("");
    try {
      await fetchJson("/api/channels/wechat/configuration", { method: "DELETE" });
      setExpanded(false); setScanActive(false); setClearedLocally(true); setClearDialogOpen(false);
      setMessage("微信 claw 连接配置已清空，可以重新配置其他微信账号。");
      await refresh().catch(() => {});
    } catch (error) { setMessage(errorMessage(error)); setClearDialogOpen(false); }
    finally { setClearing(false); }
  };

  return <div className="connection-operation-flow">
    <div className="connection-auth-action">{configured
      ? <Button className="connection-compact-action" variant="danger" disabled={clearing} onClick={() => setClearDialogOpen(true)}><Trash2 />{clearing ? "正在清空…" : "清空配置"}</Button>
      : <Button className="connection-compact-action" variant="primary" disabled={scanActive} onClick={openScanPanel}>{scanActive ? <><LoaderCircle className="connection-spinner" />等待扫码确认</> : <><QrCode />配置</>}</Button>}
      {message ? <span className="connection-action-message" role="status">{message}</span> : null}
    </div>
    {expanded ? <WechatConnectPanel key={panelAttempt} connected={false} autoStart onActiveChange={setScanActive} onCancel={() => { setExpanded(false); setScanActive(false); }} onConnected={async () => { setClearedLocally(false); await refresh(); }} compact /> : null}
    {clearDialogOpen ? <ConnectionClearDialog connectionName="微信 claw" configurationSummary="登录凭据、同步游标、上下文缓存和当前账号绑定都会从当前隔离空间清空。" preservedSummary="已形成的本机对话记录和用户文件不会被删除。" releaseSummary="该微信账号可在另一个隔离空间重新配置。" busy={clearing} onCancel={() => setClearDialogOpen(false)} onConfirm={() => void clearConfiguration()} /> : null}
  </div>;
}
