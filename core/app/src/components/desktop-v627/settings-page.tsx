"use client";

import { useState } from "react";
import type { RuntimeData } from "./types";
import { useJson } from "./shared";
import { Badge, Button, Card, SettingRow } from "../desktop-v72/primitives";
import { SettingsLayout } from "../desktop-v72/settings-layout";
import { PasswordSettingsDialog } from "./password-settings-dialog";
import { DataExportControl } from "./data-export-control";
import { AuthorizationModeSetting } from "./authorization-mode-setting";

export function SettingsPage() {
  const runtime = useJson<RuntimeData>("/api/node/v1/client/runtime");
  const [dialog, setDialog] = useState<"password" | "workspace" | null>(null);
  const [feedback, setFeedback] = useState("");
  return <SettingsLayout active="settings"><div className="settings-inner"><h1>设置</h1><p>管理这台电脑上的 Personal Agent 行为。桌面客户端始终作为本机可信入口。</p>
    <Card className="setting-group"><SettingRow title="开机时启动" description="由桌面客户端安装状态和系统登录项管理" control={<Badge>随客户端</Badge>} /><SettingRow title="服务生命周期" description="随客户端启动并持续保活，关闭客户端时一同停止" control={<Badge tone="success">随客户端</Badge>} /><SettingRow title="后台检查更新" description="发现新版本时只在侧栏显示，不自动安装" control={<Badge tone="success">已启用</Badge>} /></Card>
    <h2 className="settings-section-title">访问安全</h2><Card className="setting-group"><SettingRow title="这台电脑" description="桌面客户端无需登录，直接进入本机工作区" control={<Badge tone="success">本机可信</Badge>} /><SettingRow title="手机与私有域名" description="使用访问密码保护，修改后其他设备会话失效" control={<Button onClick={() => setDialog("password")}>修改密码</Button>} /><AuthorizationModeSetting /></Card>
    <h2 className="settings-section-title">数据导出</h2><Card className="setting-group"><SettingRow title="个人工作区" description="Workspace、邮件、技能与应用数据保存在用户选择的目录" control={<Button onClick={() => setDialog("workspace")}>查看</Button>} /><SettingRow title="导出数据" description="将邮件、发布页、历史规划与 SQLite 数据库打包为 ZIP 文件" control={<DataExportControl onFeedback={setFeedback} />} /><SettingRow title="客户端版本" description="桌面端、Agent 与 Core 同步更新" control={<Badge>{runtime.value?.version || "读取中"}</Badge>} /></Card>
    {dialog === "password" ? <PasswordSettingsDialog onClose={() => setDialog(null)} onSaved={(message) => { setFeedback(message); setDialog(null); }} /> : null}
    {dialog === "workspace" ? <div className="settings-dialog-backdrop" role="presentation" onMouseDown={() => setDialog(null)}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="workspace-dialog-title">个人工作区</h2><code>{runtime.value?.workspaceRoot || "读取中…"}</code><p>邮件、SQLite 数据库、技能、应用和发布页内容均保存在此目录。</p><div className="settings-dialog-actions"><Button onClick={() => setDialog(null)}>关闭</Button></div></section></div> : null}
    {feedback ? <div className="notice" role="status" style={{ marginTop: 12 }}>{feedback}</div> : null}
  </div></SettingsLayout>;
}
