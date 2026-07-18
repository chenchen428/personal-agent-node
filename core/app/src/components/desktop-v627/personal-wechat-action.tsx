"use client";

import { MessageCircle, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { ConnectionOperationSop, type ConnectionOperationStep } from "./connection-operation-sop";
import type { Connection, PersonalWechatDirectory, PersonalWechatPolicy, PersonalWechatSetup } from "./connection-types";
import { PersonalWechatPolicyEditor } from "./personal-wechat-policy";
import { PersonalWechatSetupGuide } from "./personal-wechat-setup-guide";
import { errorMessage, fetchJson } from "./shared";

type Phase = "idle" | "detecting" | "configuring" | "saving" | "complete" | "failed";

export function PersonalWechatAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const [phase, setPhase] = useState<Phase>(connection.state === "connected" ? "complete" : "idle");
  const [expanded, setExpanded] = useState(connection.state !== "connected");
  const [directory, setDirectory] = useState<PersonalWechatDirectory | null>(null);
  const [policy, setPolicy] = useState<PersonalWechatPolicy | null>(null);
  const [setup, setSetup] = useState<PersonalWechatSetup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [message, setMessage] = useState(connection.state === "needs_policy" ? "千寻已连接，请读取联系人和群并配置访问策略。" : "");

  useEffect(() => {
    let active = true;
    void fetchJson<{ setup: PersonalWechatSetup }>("/api/connections/wechat-personal/setup")
      .then((result) => { if (active) { setSetup(result.setup); setSetupError(""); } })
      .catch((error) => { if (active) setSetupError(errorMessage(error)); });
    return () => { active = false; };
  }, []);

  const detect = async () => {
    setPhase("detecting"); setExpanded(true); setMessage("正在检测本机千寻并读取当前微信账号、联系人和群。");
    try {
      await fetchJson("/api/connections/wechat-personal/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: "http://127.0.0.1:8055", endpointStyle: "auto" }) });
      const [directoryResult, policyResult] = await Promise.all([
        fetchJson<{ directory: PersonalWechatDirectory }>("/api/connections/wechat-personal/directory"),
        fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy"),
      ]);
      setDirectory(directoryResult.directory); setPolicy(policyResult.policy); setPhase(policyResult.policy.enabled ? "complete" : "configuring");
      setMessage("已从千寻读取当前登录账号、联系人和群。请确认访问策略。");
    } catch (error) { setPhase("failed"); setMessage(errorMessage(error)); }
  };

  const save = async (nextPolicy: PersonalWechatPolicy) => {
    setPhase("saving"); setMessage("正在保存访问策略并启用消息接收。");
    try {
      const result = await fetchJson<{ policy: PersonalWechatPolicy }>("/api/connections/wechat-personal/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(nextPolicy) });
      setPolicy(result.policy); setPhase("complete"); setMessage("访问策略已保存在本机，合规消息现在会触发主 Agent。"); await refresh();
    } catch (error) { setPhase("configuring"); setMessage(errorMessage(error)); }
  };

  const connected = phase === "complete" && policy?.enabled;
  return <div className="personal-wechat-flow">
    <div className="connection-auth-action"><Button className="connection-compact-action" variant="primary" disabled={phase === "detecting" || phase === "saving"} onClick={() => void detect()}><PlugZap />{phase === "detecting" ? "正在读取千寻" : connection.state === "connected" ? "重新读取并配置" : "检测千寻并配置"}</Button></div>
    <ConnectionOperationSop icon={<MessageCircle />} title="个人微信连接" summary={message || "先安装千寻、登录微信并配置消息回调，读取成功后才会显示联系人和群"} tone={connected ? "success" : phase === "failed" ? "danger" : phase === "idle" ? "neutral" : "working"} statusLabel={connected ? "连接成功" : phase === "failed" ? "检测失败" : phase === "configuring" ? "待保存策略" : phase === "idle" ? "等待接入" : "配置中"} steps={personalWechatSteps(phase, Boolean(directory), Boolean(policy?.enabled))} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)}>
      <PersonalWechatSetupGuide setup={setup} error={phase === "failed" ? message : setupError} errorTitle={phase === "failed" ? "上次检测未通过" : "回调地址读取失败"} />
      {directory && policy ? <PersonalWechatPolicyEditor key={directory.readAt} directory={directory} initialPolicy={policy} saving={phase === "saving"} saved={phase === "complete"} onSave={save} /> : null}
    </ConnectionOperationSop>
  </div>;
}

function personalWechatSteps(phase: Phase, hasDirectory: boolean, policyEnabled: boolean): ConnectionOperationStep[] {
  if (phase === "failed") return stepStatuses(["failed", "pending", "pending", "pending", "pending"]);
  if (phase === "detecting") return stepStatuses(["active", "pending", "pending", "pending", "pending"]);
  if (phase === "saving") return stepStatuses(["passed", "passed", "passed", "passed", "active"]);
  if (phase === "complete" && policyEnabled) return stepStatuses(["passed", "passed", "passed", "passed", "passed"]);
  if (hasDirectory) return stepStatuses(["passed", "passed", "passed", "active", "pending"]);
  return stepStatuses(["pending", "pending", "pending", "pending", "pending"]);
}

function stepStatuses(statuses: ConnectionOperationStep["status"][]): ConnectionOperationStep[] {
  return ["检测千寻", "读取登录账号", "读取联系人与群", "配置访问策略", "启用消息接收"].map((label, index) => ({ id: String(index), label, status: statuses[index] }));
}
