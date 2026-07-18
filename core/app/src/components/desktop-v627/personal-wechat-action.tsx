"use client";

import Link from "next/link";
import { History, MessageCircle, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import type { Connection, PersonalWechatConnectivityTest, PersonalWechatDirectory, PersonalWechatPolicy, PersonalWechatSetup } from "./connection-types";
import { PersonalWechatConnectivityTestCard } from "./personal-wechat-connectivity-test";
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
    setPhase("detecting"); setExpanded(true); setMessage("正在检测本机千寻 Pro 并读取当前微信账号、联系人和群。");
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await fetchJson("/api/connections/wechat-personal/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl, endpointStyle: "auto" }) });
      setSetup((value) => value ? { ...value, qianxunBaseUrl: baseUrl } : value);
      const [directoryResult, policyResult] = await Promise.all([
        fetchJson<{ directory: PersonalWechatDirectory }>("/api/connections/wechat-personal/directory"),
        fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy"),
      ]);
      setDirectory(directoryResult.directory); setPolicy(policyResult.policy); setPhase(policyResult.policy.enabled ? connectivity?.phase === "complete" ? "complete" : "testing" : "configuring");
      setMessage(policyResult.policy.enabled ? "千寻 Pro 和访问策略已就绪，请完成文件传输助手的收发测试。" : "已从千寻 Pro 读取当前登录账号、联系人和群。请确认访问策略。");
    } catch (error) { setPhase("failed"); setMessage(errorMessage(error)); }
  };

  const save = async (nextPolicy: PersonalWechatPolicy): Promise<boolean> => {
    setPhase("saving"); setMessage("正在保存访问策略并启用消息接收。");
    try {
      const result = await fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(nextPolicy) });
      setPolicy(result.policy); setPhase("testing"); setMessage("访问策略已保存。请通过文件传输助手完成消息回调和测试回复，两项通过后才算连接完成。"); await refresh().catch(() => {}); return true;
    } catch (error) { setPhase("configuring"); setMessage(errorMessage(error)); return false; }
  };

  const handleConnectivity = (state: PersonalWechatConnectivityTest) => {
    setConnectivity(state);
    if (state.phase === "complete") { setPhase("complete"); setMessage("消息回调和测试回复均已通过，个人微信连接完成。"); void refresh().catch(() => {}); }
    else if (policy?.enabled) { setPhase("testing"); setMessage(state.phase === "message_received" || state.phase === "reply_planned" ? "消息回调已收到，请确认并完成测试回复。" : "请通过文件传输助手完成消息回调和测试回复。"); }
  };
  const connected = phase === "complete" && policy?.enabled && connectivity?.phase === "complete";
  return <div className="personal-wechat-flow">
    <div className="connection-auth-action"><Button className="connection-compact-action" variant="primary" disabled={phase === "detecting" || phase === "saving"} onClick={() => void detect()}><PlugZap />{phase === "detecting" ? "正在读取千寻 Pro" : connection.state === "connected" ? "重新读取并配置" : "检测千寻 Pro 并配置"}</Button></div>
    <ConnectionOperationSop icon={<MessageCircle />} title="个人微信连接" summary={message || "先安装并授权千寻 Pro、登录微信并配置消息回调，读取成功后才会显示联系人和群"} tone={connected ? "success" : phase === "failed" ? "danger" : phase === "idle" ? "neutral" : "working"} statusLabel={connected ? "连接成功" : phase === "failed" ? "检测失败" : phase === "configuring" ? "待保存策略" : phase === "testing" ? "待收发测试" : phase === "idle" ? "等待接入" : "配置中"} steps={personalWechatSteps(phase, Boolean(directory), Boolean(policy?.enabled), connectivity?.phase)} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)}>
      <div className="personal-wechat-history-entry"><span><History /></span><div><strong>个人微信聊天记录</strong><p>按私聊和群聊保存在本机；Agent 处理新消息前会读取该会话最近 100 条记录。</p></div><Link className="button" href="/app/connections/wechat-personal">查看聊天记录</Link></div>
      <PersonalWechatSetupGuide setup={setup} servicePort={qianxunPort} onServicePortChange={setQianxunPort} portDisabled={phase === "detecting" || phase === "saving"} error={phase === "failed" ? message : setupError} errorTitle={phase === "failed" ? "上次检测未通过" : "回调地址读取失败"} />
      {directory && policy ? <PersonalWechatPolicyEditor key={directory.readAt} directory={directory} initialPolicy={policy} saving={phase === "saving"} saved={phase === "complete" || phase === "testing"} onSave={save} /> : null}
      <PersonalWechatConnectivityTestCard enabled={Boolean(policy?.enabled)} onStateChange={handleConnectivity} />
    </ConnectionOperationSop>
  </div>;
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
