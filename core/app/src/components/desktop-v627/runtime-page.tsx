"use client";

import { Activity, Cpu, HardDrive, RotateCw } from "lucide-react";
import type { RuntimeData } from "./types";
import { formatDuration, useJson } from "./shared";
import { Badge, Button, Card, PageHeader, PageSurface } from "../desktop-v72/primitives";

export function RuntimePage() {
  const runtime = useJson<RuntimeData>("/api/node/v1/client/runtime");
  const running = runtime.value?.state === "running";
  const services = [
    { name: "主 Agent", detail: "可接收新消息并调度任务" },
    { name: "本机 Core", detail: `版本 ${runtime.value?.version || "读取中"}` },
    { name: "邮件服务", detail: "收件内容保存在本机工作区" },
    { name: "安全访问", detail: "手机和私有域名由本机 Core 提供" },
  ];

  return <PageSurface>
    <PageHeader
      eyebrow="本机服务"
      title="运行设置"
      description="桌面客户端持续守护本机 Core；服务意外退出时会自动重新启动，关闭客户端时一同停止。"
      actions={<Button onClick={() => runtime.refresh()}><RotateCw />重新检查</Button>}
    />
    <section className="stat-grid runtime-stat-grid">
      <Card className="stat-card"><div className="stat-card-head"><span>运行时间</span><Activity /></div><div className="stat-value">{runtime.value ? formatDuration(runtime.value.uptimeSeconds) : "—"}</div><div className="stat-copy">本机 Core 当前运行周期</div></Card>
      <Card className="stat-card"><div className="stat-card-head"><span>服务状态</span><Cpu /></div><div className="stat-value">{running ? "正常" : "—"}</div><div className="stat-copy">客户端持续检测并自动保活</div></Card>
      <Card className="stat-card"><div className="stat-card-head"><span>当前版本</span><HardDrive /></div><div className="stat-value" style={{ fontSize: 17 }}>{runtime.value?.version || "读取中"}</div><div className="stat-copy">客户端、Agent 与 Core</div></Card>
    </section>
    <Card className="section-list runtime-service-list">
      <header className="section-heading"><strong>服务状态</strong><span>客户端持续守护</span></header>
      {services.map((service) => <div className="plain-row" key={service.name}><i className={`status-dot ${running ? "success" : "danger"}`} /><span className="row-copy"><strong>{service.name}</strong><small>{service.detail}</small></span><Badge tone={running ? "success" : "danger"}>{running ? "正常" : "正在恢复"}</Badge></div>)}
    </Card>
  </PageSurface>;
}
