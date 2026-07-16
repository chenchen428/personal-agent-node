"use client";

import type { PersonalApp } from "./types";
import { Empty, Heading, useJson } from "./shared";

export function AppsPage() {
  const { value, loading } = useJson<{ apps: PersonalApp[] }>("/api/system/apps");
  const apps = (value?.apps || []).filter((app) => app.compatible && app.route);
  const tones = ["dark", "mint", "coral"];
  return <main><Heading eyebrow="应用" title="我的应用" copy="这些应用可以在适合的设备上打开。" action={<span className="pa-status">{apps.length} 个可用</span>} /><div className="desktop-app-grid">{apps.map((app, index) => <a className={`desktop-app-card ${tones[index % tones.length]}`} href={app.route} key={app.id}><span className="desktop-app-symbol">{app.name.slice(0, 1)}</span><div><small>手机 · 电脑</small><h2>{app.name}</h2><p>{app.description || "打开这台电脑上的 Personal App。"}</p></div><strong>打开应用 →</strong></a>)}{!loading && !apps.length ? <Empty text="还没有可用应用" /> : null}</div></main>;
}
