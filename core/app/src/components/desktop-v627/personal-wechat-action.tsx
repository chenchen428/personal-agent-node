"use client";

import Link from "next/link";
import { CheckCircle2, History, MessageCircle, PlugZap, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import type { Connection, PersonalWechatConnectivityTest, PersonalWechatDirectory, PersonalWechatPolicy, PersonalWechatSetup } from "./connection-types";
import { PersonalWechatConnectivityTestCard } from "./personal-wechat-connectivity-test";
import { ConnectionClearDialog } from "./connection-clear-dialog";
import { PersonalWechatPolicyEditor } from "./personal-wechat-policy";
import { PersonalWechatSetupGuide } from "./personal-wechat-setup-guide";
import { errorMessage, fetchJson } from "./shared";

type Phase = "idle" | "detecting" | "configuring" | "saving" | "testing" | "complete" | "failed";

export function PersonalWechatAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [phase, setPhase] = useState<Phase>(connection.state === "connected" ? "complete" : "idle");
  const [expanded, setExpanded] = useState(connection.state !== "connected");
  const [directory, setDirectory] = useState<PersonalWechatDirectory | null>(null);
  const [policy, setPolicy] = useState<PersonalWechatPolicy | null>(null);
  const [connectivity, setConnectivity] = useState<PersonalWechatConnectivityTest | null>(null);
  const [setup, setSetup] = useState<PersonalWechatSetup | null>(null);
  const [qianxunPort, setQianxunPort] = useState("8055");
  const [setupError, setSetupError] = useState("");
  const [message, setMessage] = useState(connection.state === "needs_policy" ? "千寻 Pro 已连接，请读取联系人和群并配置访问策略。" : connection.state === "needs_test" ? "访问策略已保存，请完成文件传输助手收发测试。" : "");
  const [reconfiguring, setReconfiguring] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    let active = true;
    void fetchJson<{ setup: PersonalWechatSetup }>("/api/connections/wechat-personal/setup")
      .then((result) => { if (active) { setSetup(result.setup); setQianxunPort(portFromBaseUrl(result.setup.qianxunBaseUrl)); setSetupError(""); } })
      .catch((error) => { if (active) setSetupError(errorMessage(error)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy"),
      fetchJson<{ test: PersonalWechatConnectivityTest }>("/api/connections/wechat-personal/connectivity-test"),
    ]).then(([policyResult, testResult]) => {
      if (!active) return;
      setPolicy(policyResult.policy); setConnectivity(testResult.test);
      if (policyResult.policy.enabled) setPhase(testResult.test.phase === "complete" ? "complete" : "testing");
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const detect = async () => {
    const port = validPort(qianxunPort);
    if (!port) { setPhase("failed"); setExpanded(true); setMessage("请输入 1 到 65535 之间的千寻服务端口。"); return; }
    const currentAttempt = ++attempt.current;
    setReconfiguring(connection.state === "connected" || connectedState(policy, connectivity));
    setPhase("detecting"); setExpanded(true); setMessage("正在检测本机千寻 Pro 并读取当前微信账号、联系人和群。");
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await fetchJson("/api/connections/wechat-personal/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl, endpointStyle: "auto" }) });
      setSetup((value) => value ? { ...value, configured: true, qianxunBaseUrl: baseUrl } : value);
      const [directoryResult, policyResult] = await Promise.all([
        fetchJson<{ directory: PersonalWechatDirectory }>("/api/connections/wechat-personal/directory"),
        fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy"),
      ]);
      if (attempt.current !== currentAttempt) return;
      setDirectory(directoryResult.directory); setPolicy(policyResult.policy); setPhase("configuring");
      setMessage("已从千寻 Pro 读取当前登录账号、联系人和群。请确认访问策略。");
    } catch (error) { if (attempt.current === currentAttempt) { setPhase("failed"); setMessage(errorMessage(error)); } }
  };

  const save = async (nextPolicy: PersonalWechatPolicy): Promise<boolean> => {
    setPhase("saving"); setMessage("正在保存访问策略并启用消息接收。");
    try {
      const result = await fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(nextPolicy) });
      setPolicy(result.policy);
      const alreadyVerified = connectivity?.phase === "complete";
      setPhase(alreadyVerified ? "complete" : "testing");
      setReconfiguring(false);
      setMessage(alreadyVerified ? "访问策略已更新，原有收发连通验证仍然有效。" : "访问策略已保存。请通过文件传输助手完成消息回调和测试回复，两项通过后才算连接完成。");
      await refresh().catch(() => {}); return true;
    } catch (error) { setPhase("configuring"); setMessage(errorMessage(error)); return false; }
  };

  const handleConnectivity = (state: PersonalWechatConnectivityTest) => {
    setConnectivity(state);
    if (state.phase === "complete") { setPhase("complete"); setMessage("消息回调和测试回复均已通过，个人微信连接完成。"); void refresh().catch(() => {}); }
    else if (policy?.enabled) { setPhase("testing"); setMessage(state.phase === "message_received" || state.phase === "reply_planned" ? "消息回调已收到，请确认并完成测试回复。" : "请通过文件传输助手完成消息回调和测试回复。"); }
  };
  const cancelReconfiguration = () => {
    attempt.current += 1;
    setReconfiguring(false);
    setPhase("complete");
    setExpanded(false);
    setMessage("已取消本次重新配置，原有个人微信连接保持不变。");
  };
  const clearConfiguration = async () => {
    setClearing(true);
    try {
      await fetchJson("/api/connections/wechat-personal/configuration", { method: "DELETE" });
      attempt.current += 1;
      setDirectory(null); setPolicy(null); setConnectivity(null); setReconfiguring(false);
      setSetup((value) => value ? { ...value, configured: false, qianxunBaseUrl: "http://127.0.0.1:8055" } : value);
      setQianxunPort("8055"); setPhase("idle"); setExpanded(false); setClearDialogOpen(false);
      setMessage("个人微信连接配置已清空，可重新配置其他微信账号。");
      await refresh().catch(() => {});
    } catch (error) {
      setPhase("failed"); setExpanded(true); setMessage(errorMessage(error)); setClearDialogOpen(false);
    } finally { setClearing(false); }
  };
  const connected = phase === "complete" && (connectedState(policy, connectivity) || connection.state === "connected");
  const hasConfiguration = setup?.configured ?? ["connected", "needs_policy", "needs_test", "space_conflict"].includes(connection.state);
  const steps = personalWechatSteps(phase, Boolean(directory), Boolean(policy?.enabled), connectivity?.phase);
  const setupPanel = <PersonalWechatSetupGuide setup={setup} servicePort={qianxunPort} onServicePortChange={setQianxunPort} portDisabled={phase === "detecting" || phase === "saving"} error={phase === "failed" ? message : setupError} errorTitle={phase === "failed" ? "上次检测未通过" : "回调地址读取失败"} />;
  const readingPanel = <div className="domain-human-guide" role="status"><strong>正在读取千寻 Pro</strong><p>{message || "检测登录账号、联系人和群后，会进入访问策略配置。"}</p></div>;
  const policyPanel = directory && policy ? <PersonalWechatPolicyEditor key={directory.readAt} directory={directory} initialPolicy={policy} saving={phase === "saving"} saved={false} onSave={save} /> : readingPanel;
  const connectivityPanel = <PersonalWechatConnectivityTestCard enabled={Boolean(policy?.enabled)} onStateChange={handleConnectivity} />;
  const completedPanel = <><div className="connection-success-evidence"><CheckCircle2 /><div><strong>个人微信连接已生效</strong><span>访问策略、消息回调和测试回复均已通过；需要调整时可重新发起配置。</span></div></div><div className="personal-wechat-history-entry"><span><History /></span><div><strong>个人微信聊天记录</strong><p>按私聊和群聊保存在本机；Agent 处理新消息前会读取该会话最近 100 条记录。</p></div><Link className="button" href="/app/connections/wechat-personal">查看聊天记录</Link></div></>;
  return <div className="personal-wechat-flow">
    <div className="connection-auth-action">{hasConfiguration ? <Button className="connection-compact-action" variant="danger" disabled={clearing} onClick={() => setClearDialogOpen(true)}><Trash2 />{clearing ? "正在清空…" : "清空配置"}</Button> : <Button className="connection-compact-action" variant="primary" disabled={phase === "detecting" || phase === "saving"} onClick={() => void detect()}><PlugZap />{phase === "detecting" ? "正在读取千寻 Pro" : "配置"}</Button>}{reconfiguring ? <Button className="connection-compact-action" onClick={cancelReconfiguration}><X />取消重新配置</Button> : null}</div>
    <ConnectionOperationSop icon={<MessageCircle />} title="个人微信连接" summary={message || "先安装并授权千寻 Pro、登录微信并配置消息回调，读取成功后才会显示联系人和群"} tone={connected ? "success" : phase === "failed" ? "danger" : phase === "idle" ? "neutral" : "working"} statusLabel={connected ? "连接成功" : phase === "failed" ? "检测失败" : phase === "configuring" ? "待保存策略" : phase === "testing" ? "待收发测试" : phase === "idle" ? "等待接入" : "配置中"} steps={steps} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)} stepPanels={{ "0": setupPanel, "1": readingPanel, "2": readingPanel, "3": policyPanel, "4": connectivityPanel, "5": connectivityPanel, "6": completedPanel }} />
    {clearDialogOpen ? <ConnectionClearDialog connectionName="个人微信" configurationSummary="千寻 Pro 地址、账号绑定、SafeKey、访问策略和收发测试状态都会从当前隔离空间清空。" preservedSummary="个人微信聊天记录属于本机数据，不会被删除。" releaseSummary="该微信账号可在另一个隔离空间重新配置。" busy={clearing} onCancel={() => setClearDialogOpen(false)} onConfirm={() => void clearConfiguration()} /> : null}
  </div>;
}

function connectedState(policy: PersonalWechatPolicy | null, connectivity: PersonalWechatConnectivityTest | null) {
  return policy?.enabled === true && connectivity?.phase === "complete";
}

function portFromBaseUrl(baseUrl: string) {
  try { return new URL(baseUrl).port || "8055"; }
  catch { return "8055"; }
}

function validPort(value: string) {
  if (!/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? String(port) : null;
}

function personalWechatSteps(phase: Phase, hasDirectory: boolean, policyEnabled: boolean, testPhase?: PersonalWechatConnectivityTest["phase"]): ConnectionOperationStep[] {
  if (phase === "failed") return stepStatuses(["failed", "pending", "pending", "pending", "pending", "pending", "pending"]);
  if (phase === "detecting") return stepStatuses(["active", "pending", "pending", "pending", "pending", "pending", "pending"]);
  if (phase === "saving") return stepStatuses(["passed", "passed", "passed", "active", "pending", "pending", "pending"]);
  if (phase === "complete" && policyEnabled && testPhase === "complete") return stepStatuses(["passed", "passed", "passed", "passed", "passed", "passed", "passed"]);
  if (policyEnabled) {
    const received = ["message_received", "reply_planned", "complete"].includes(testPhase || "");
    const replied = testPhase === "complete";
    return stepStatuses(["passed", "passed", "passed", "passed", received ? "passed" : "active", replied ? "passed" : received ? "active" : "pending", replied ? "passed" : "pending"]);
  }
  if (hasDirectory) return stepStatuses(["passed", "passed", "passed", "active", "pending", "pending", "pending"]);
  return stepStatuses(["pending", "pending", "pending", "pending", "pending", "pending", "pending"]);
}

function stepStatuses(statuses: ConnectionOperationStep["status"][]): ConnectionOperationStep[] {
  return ["检测千寻 Pro", "读取登录账号", "读取联系人与群", "配置访问策略", "接收测试消息", "发送测试回复", "完成连接"].map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}
