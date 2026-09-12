"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Globe2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Button, KeyValueGrid } from "../desktop-v72/primitives";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import type { Connection } from "./connection-types";
import { browserPlatformStatus, createBrowserPlatformConnection, type BrowserConnectionSnapshot } from "./browser-platform-connection";

export function OpenCliAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<BrowserConnectionSnapshot>({ connection, phase: "idle", message: "" });
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  const flow = useMemo(() => createBrowserPlatformConnection({ initial: connection, publish: setSnapshot, refresh: () => refreshRef.current() }), [connection.id]);
  useEffect(() => { void flow.check(); return () => flow.dispose(); }, [flow]);
  useEffect(() => { flow.observe(connection); }, [connection, flow]);
  const current = snapshot.connection;
  const { browserReady, loginState, searchReady, connected, label } = browserPlatformStatus(current);
  const busy = snapshot.phase === "checking" || snapshot.phase === "opening";
  const waiting = snapshot.phase === "waiting";
  const needsSetup = current.state === "needs_setup";
  const environmentalFailure = ["error", "needs_setup"].includes(current.state);
  const status: ConnectionOperationStep["status"][] = [
    browserReady ? "passed" : busy ? "active" : environmentalFailure ? "failed" : "pending",
    loginState === "logged_in" ? "passed" : waiting ? "active" : "pending",
    connected ? "passed" : loginState === "logged_in" && busy ? "active" : "pending",
  ];
  const steps = ["检查浏览器环境", "确认平台登录", "确认搜索可用"].map((name, index) => ({ id: String(index), label: name, status: status[index] }));
  return <div className="connection-operation-flow">
    <div className="connection-auth-action">
      {browserReady ? <Button className="connection-compact-action" variant="primary" disabled={busy} onClick={() => void flow.open(!connected)}><ExternalLink />{snapshot.phase === "opening" ? "正在打开…" : connected ? `打开 ${connection.name}` : "在浏览器登录"}</Button> : null}
      <Button className="connection-compact-action" disabled={busy} onClick={() => void flow.check()}>{snapshot.phase === "checking" ? <LoaderCircle className="connection-spinner" /> : <RefreshCw />}{snapshot.phase === "checking" ? "正在检测…" : waiting ? "我已登录，重新检测" : "重新检测"}</Button>
      {needsSetup && current.setup?.browserBridgeInstallUrl ? <a className="button" href={current.setup.browserBridgeInstallUrl} target="_blank" rel="noreferrer">修复浏览器连接 <ExternalLink /></a> : null}
      {waiting || busy ? <Button className="connection-compact-action" onClick={() => flow.cancel()}><X />取消等待</Button> : null}
    </div>
    <ConnectionOperationSop icon={<Globe2 />} title={`${connection.name} 连接`} summary={snapshot.message || (connected ? "平台登录已确认" : "请在浏览器登录后完成检测")} tone={connected ? "success" : busy || waiting ? "working" : environmentalFailure ? "danger" : "neutral"} statusLabel={busy ? "检测中" : waiting ? "等待登录" : label} steps={steps}>
      <KeyValueGrid items={[
        { label: "浏览器环境", value: browserReady ? "可用" : environmentalFailure ? "需要修复" : "待确认" },
        { label: "平台登录", value: loginState === "logged_in" ? "已确认登录" : loginState === "logged_out" ? "尚未登录" : "未确认" },
        { label: "搜索与阅读", value: connected && searchReady ? "可用" : "暂不可用" },
      ]} />
      {connected ? <div className="connection-success-evidence"><CheckCircle2 /><div><strong>{connection.name} 已连接</strong><span>现在可以让 Agent 搜索和阅读平台内容。</span></div></div> : <div className="domain-human-guide" role="status"><strong>{environmentalFailure ? "先恢复浏览器连接" : loginState === "logged_in" ? "登录已确认，搜索状态仍需检测" : "在浏览器中完成平台登录"}</strong><p>{snapshot.message || "打开平台页面，手动完成登录、验证码或二次验证，再返回这里检测。"}</p></div>}
    </ConnectionOperationSop>
  </div>;
}
