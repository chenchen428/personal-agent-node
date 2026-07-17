"use client";

import { Activity, CircleStop, Cpu, HardDrive, RotateCw } from "lucide-react";
import { useState } from "react";
import type { RuntimeData } from "./types";
import { formatDuration, useJson } from "./shared";
import { Badge, Button, Card, PageHeader, PageSurface } from "../desktop-v72/primitives";

export function RuntimePage() {
  const runtime = useJson<RuntimeData>("/api/node/v1/client/runtime");
  const [confirming, setConfirming] = useState(false);
  const running = runtime.value?.state === "running";
  const services = [{ name: "主 Agent", detail: "可接收新消息并调度任务" }, { name: "本机 Core", detail: `版本 ${runtime.value?.version || "读取中"}` }, { name: "邮件服务", detail: "收件内容保存在本机工作区" }, { name: "安全访问", detail: "手机和私有域名由本机 Core 提供" }];
  return <PageSurface><PageHeader eyebrow="本机服务" title="运行设置" description="查看桌面客户端与本机 Core 的生命周期。停止服务会同时暂停邮件接收和手机访问。" actions={<Button onClick={() => runtime.refresh()}><RotateCw />重新检查</Button>} />
    <section className="stat-grid"><Card className="stat-card"><div className="stat-card-head"><span>运行时间</span><Activity /></div><div className="stat-value">{runtime.value ? formatDuration(runtime.value.uptimeSeconds) : "—"}</div><div className="stat-copy">本机 Core 当前运行周期</div></Card><Card className="stat-card"><div className="stat-card-head"><span>服务状态</span><Cpu /></div><div className="stat-value">{running ? "正常" : "—"}</div><div className="stat-copy">桌面端与 Core 同步</div></Card><Card className="stat-card"><div className="stat-card-head"><span>当前版本</span><HardDrive /></div><div className="stat-value" style={{ fontSize: 17 }}>{runtime.value?.version || "读取中"}</div><div className="stat-copy">客户端、Agent 与 Core</div></Card><Card className="stat-card"><div className="stat-card-head"><span>关闭策略</span><Activity /></div><div className="stat-value">{runtime.value?.shellStopsService ? "停止" : "后台"}</div><div className="stat-copy">关闭客户端时的服务行为</div></Card></section>
    <Card className="section-list" style={{ marginTop: 12 }}><header className="section-heading"><strong>服务状态</strong><span>按需刷新</span></header>{services.map((service) => <div className="plain-row" key={service.name}><i className={`status-dot ${running ? "success" : "danger"}`} /><span className="row-copy"><strong>{service.name}</strong><small>{service.detail}</small></span><Badge tone={running ? "success" : "danger"}>{running ? "正常" : "不可用"}</Badge></div>)}</Card>
    {confirming ? <div className="notice" role="alert" style={{ marginTop: 16 }}>停止后邮件和手机访问会暂停。<div className="page-actions" style={{ marginTop: 10 }}><Button variant="danger" onClick={() => { window.location.href = "/__personal-agent/close"; }}>确认停止</Button><Button onClick={() => setConfirming(false)}>取消</Button></div></div> : null}
    <div className="page-actions" style={{ marginTop: 18, justifyContent: "flex-end" }}><Button variant="danger" onClick={() => setConfirming(true)}><CircleStop />停止 PA 服务</Button></div>
  </PageSurface>;
}
