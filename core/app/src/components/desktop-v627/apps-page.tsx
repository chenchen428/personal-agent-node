"use client";

import { ArrowUpRight } from "lucide-react";
import type { PersonalApp } from "./types";
import { useJson } from "./shared";
import { Badge, Card, PageHeader, PageSurface } from "../desktop-v72/primitives";

export function AppsPage() {
  const { value, loading } = useJson<{ apps: PersonalApp[] }>("/api/system/apps");
  const apps = (value?.apps || []).filter((app) => app.compatible && app.route);
  return <PageSurface><PageHeader title="应用" description="由主 Agent 研发并注册到这台电脑的应用。核心导航始终由 Personal Agent 维护。" />
    <section className="gallery">{apps.map((app) => <Card className="gallery-card" key={app.id}>
      <div className="gallery-preview app-gallery-preview"><b aria-hidden="true">{app.name.slice(0, 1)}</b><span>{app.name}</span></div>
      <div className="gallery-copy"><h2>{app.name}</h2><p>{app.description || "打开这台电脑上的 Personal App。"}</p><div className="gallery-meta"><Badge tone="success">可用</Badge><a href={app.desktopRoute || app.route}>桌面 · 手机 <ArrowUpRight size={12} style={{ display: "inline" }} /></a></div></div>
    </Card>)}</section>
    {!loading && !apps.length ? <div className="empty-state"><div><h2>还没有可用应用</h2><p>主 Agent 注册应用后会显示在这里。</p></div></div> : null}
  </PageSurface>;
}
