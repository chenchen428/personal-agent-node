"use client";

import { useState, type FormEvent } from "react";
import { validateLocalPasswordInput } from "@/lib/setup-tasks";
import type { RuntimeData } from "./types";
import { errorMessage, useJson } from "./shared";
import { Badge, Button, Card, SettingRow } from "../desktop-v72/primitives";
import { SettingsLayout } from "../desktop-v72/settings-layout";

export function SettingsPage() {
  const runtime = useJson<RuntimeData>("/api/node/v1/client/runtime");
  const [panel, setPanel] = useState<"password" | "workspace" | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const issue = validateLocalPasswordInput(password, confirmation);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (issue) { setFeedback(issue.replace("本机登录密码", "访问密码")); return; }
    setSaving(true);
    try {
      const post = async (phase: string, body: object) => { const response = await fetch(`/api/system/setup/actions/installation.local-auth/${phase}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok || !payload.operation) throw new Error(payload.error?.message || "更新失败"); return payload.operation; };
      const plan = await post("plan", {}); await post("approve", { operationId: plan.id, digest: plan.digest, approved: true }); await post("execute", { operationId: plan.id, digest: plan.digest, input: { password, confirmation } });
      setPassword(""); setConfirmation(""); setPanel(null); setFeedback("访问密码已更新，其他设备会话已失效。");
    } catch (cause) { setFeedback(errorMessage(cause)); } finally { setSaving(false); }
  };
  const exportDiagnostics = () => { const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), status: runtime.value?.state || "unknown", version: runtime.value?.version, contentIncluded: false }, null, 2)], { type: "application/json" }); const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = "personal-agent-diagnostics.json"; anchor.click(); URL.revokeObjectURL(anchor.href); setFeedback("脱敏诊断已导出。"); };
  return <SettingsLayout active="settings"><div className="settings-inner"><h1>设置</h1><p>管理这台电脑上的 Personal Agent 行为。桌面客户端始终作为本机可信入口。</p>
    <Card className="setting-group"><SettingRow title="开机时启动" description="由桌面客户端安装状态和系统登录项管理" control={<Badge>随客户端</Badge>} /><SettingRow title="关闭窗口后继续运行" description="关闭客户端时是否保留本机服务、邮件接收和手机访问" control={<Badge tone={runtime.value?.shellStopsService ? "warning" : "success"}>{runtime.value ? runtime.value.shellStopsService ? "停止服务" : "继续运行" : "读取中"}</Badge>} /><SettingRow title="后台检查更新" description="发现新版本时只在侧栏显示，不自动安装" control={<Badge tone="success">已启用</Badge>} /></Card>
    <h2 style={{ fontSize: 12 }}>访问安全</h2><Card className="setting-group"><SettingRow title="这台电脑" description="桌面客户端无需登录，直接进入本机工作区" control={<Badge tone="success">本机可信</Badge>} /><SettingRow title="手机与私有域名" description="使用访问密码保护，修改后其他设备会话失效" control={<Button onClick={() => setPanel("password")}>修改密码</Button>} /></Card>
    <h2 style={{ fontSize: 12 }}>数据与隐私</h2><Card className="setting-group"><SettingRow title="个人工作区" description="Workspace、邮件、技能与应用数据保存在用户目录" control={<Button onClick={() => setPanel("workspace")}>查看</Button>} /><SettingRow title="诊断信息" description="仅收集脱敏运行状态，不包含客户内容" control={<Button onClick={exportDiagnostics}>导出诊断</Button>} /><SettingRow title="客户端版本" description="桌面端、Agent 与 Core 同步更新" control={<Badge>{runtime.value?.version || "读取中"}</Badge>} /></Card>
    {panel === "password" ? <form className="settings-action-panel" onSubmit={submit}><strong>修改访问密码</strong><input type="password" minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} aria-label="新的访问密码" placeholder="至少 12 个字符" /><input type="password" minLength={12} maxLength={256} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label="确认访问密码" placeholder="再次输入" /><Button variant="primary" disabled={saving || Boolean(issue)}>{saving ? "保存中…" : "保存"}</Button><Button type="button" onClick={() => setPanel(null)}>关闭</Button></form> : null}
    {panel === "workspace" ? <section className="settings-action-panel"><strong>个人工作区</strong><code>~/.personal-agent/workspace</code><p>邮件、技能、应用和发布页内容均保存在此目录。</p><Button onClick={() => setPanel(null)}>关闭</Button></section> : null}
    {feedback ? <div className="notice" role="status" style={{ marginTop: 12 }}>{feedback}</div> : null}
  </div></SettingsLayout>;
}
