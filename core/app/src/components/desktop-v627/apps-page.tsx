"use client";

import Link from "next/link";
import { ArrowUpRight, Bot } from "lucide-react";
import type { PersonalApp } from "./types";
import { useJson } from "./shared";
import { Badge, Card, PageHeader, PageSurface } from "../desktop-v72/primitives";
import { LoadingState } from "../desktop-v72/loading-state";

export function AppsPage() {
  const { value, loading } = useJson<{ apps: PersonalApp[] }>("/api/system/apps");
  const apps = (value?.apps || []).filter((app) => app.compatible && app.route);
  const draft = "帮我开发一个自定义应用。先和我确认使用场景、桌面端和移动端入口，以及需要使用的 Agent 组件、资源和连接；给出方案后再开始开发。";
  return <PageSurface><PageHeader title="全部应用" description="桌面端和移动端共享同一应用注册，并按授权使用 Agent 组件、资源和连接。" />
    <section className="app-builder-guide"><div className="app-builder-guide-copy"><span><Bot /></span><div><h2>告诉 Agent 你想开发什么</h2><p>说明使用场景和期望结果即可。Agent 会继续确认桌面与移动入口，以及需要共享的组件、资源和连接。</p><code>{draft}</code></div></div><Link className="button primary" href={`/app/conversations?draft=${encodeURIComponent(draft)}`}>和 Agent 开始开发</Link></section>
    {loading && !value ? <LoadingState label="正在读取应用" /> : <section className="gallery">{apps.map((app) => <Card className="gallery-card" key={app.id}>
      <div className="gallery-preview app-gallery-preview"><b aria-hidden="true">{app.name.slice(0, 1)}</b><span>{app.name}</span></div>
      <div className="gallery-copy"><h2>{app.name}</h2><p>{app.description || "打开这台电脑上的 Personal App。"}</p><div className="gallery-meta"><Badge tone="success">可用</Badge><a href={app.desktopRoute || app.route}>桌面 · 手机 <ArrowUpRight size={12} style={{ display: "inline" }} /></a></div></div>
    </Card>)}</section>}
    {!loading && !apps.length ? <div className="empty-state"><div><h2>还没有可用应用</h2><p>主 Agent 注册应用后会显示在这里。</p></div></div> : null}
  </PageSurface>;
}
